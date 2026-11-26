// Explicit global marker tracking whether this module has been evaluated in the current Node process
(globalThis as Record<string, unknown>).__sparta_server_daemon_module_loaded = true;

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from './db';
import { portalStoresEnabled } from './sparta-master-contract';
import { SpartaIntegrationError } from './sparta-identity';
import { fetchDisasterFeed } from './disaster-service';
import { dbUpsertEarthquakeEvent, dbGetPendingEarthquakeEvents } from './earthquake-db';
import { executeEarthquakeV1MmiWorkflow } from './earthquake-v1-mmi-service';
import {
  hasEventAlreadyBeenProcessed,
  isNotificationCooldownActive,
  recordNotificationLog
} from './notification-service';
import { AffectedStoreSummary } from '@/types/notification';
import { Store } from '@/types/store';
import { Earthquake } from '@/types/disaster';
import { getExternalApiConfig } from './runtime-config';
import { isDevelopmentReadOnlyMode, isSimulationAllowed } from './environment-policy';

import {
  getLastStoreSyncHistory,
  StoreSyncHistoryRecord
} from './google-sheets-sync';
import { syncMasterStores } from './store-sync';

export const AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES = parseInt(process.env.AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES || '60', 10);
export const AUTO_EARTHQUAKE_BACKFILL_MAX_AGE_MINUTES = parseInt(process.env.AUTO_EARTHQUAKE_BACKFILL_MAX_AGE_MINUTES || '1440', 10);
export const AUTO_EARTHQUAKE_MAX_AGE_MINUTES = AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES;
export const MANUAL_EARTHQUAKE_MATCH_WINDOW_MINUTES = parseInt(process.env.MANUAL_EARTHQUAKE_MATCH_WINDOW_MINUTES || '120', 10);
export const STORE_SYNC_INTERVAL_HOURS = parseInt(process.env.STORE_SYNC_INTERVAL_HOURS || '24', 10);
export const STORE_SYNC_INTERVAL_MS = STORE_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
export const WORKER_DISASTER_ADVISORY_LOCK_ID = 7421840;
export const WORKER_STORE_SYNC_ADVISORY_LOCK_ID = 7421842;

export interface DisasterCycleHealth {
  lastCycleStart: string | null;
  lastCycleFinished: string | null;
  lastCycleDurationMs: number;
  lastDisasterCount: number;
  lastBranchesCount: number;
  lastDispatchedEarthquakeAlerts: number;
  lastDispatchedRainAlerts: number;
  lastStatus: 'healthy' | 'running' | 'idle' | 'error';
  lastError: string | null;
}

let lastCycleHealth: DisasterCycleHealth = {
  lastCycleStart: null,
  lastCycleFinished: null,
  lastCycleDurationMs: 0,
  lastDisasterCount: 0,
  lastBranchesCount: 0,
  lastDispatchedEarthquakeAlerts: 0,
  lastDispatchedRainAlerts: 0,
  lastStatus: 'idle',
  lastError: null,
};

export function getDisasterCycleHealth(): DisasterCycleHealth {
  return { ...lastCycleHealth };
}

let isCycleRunning = false;
let initialTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let isDaemonStopped = false;

let isStoreSyncRunning = false;
let storeSyncInitialTimer: NodeJS.Timeout | null = null;
let storeSyncIntervalTimer: NodeJS.Timeout | null = null;

import { getOrLoadMasterStores, getBranchCentroidsFromStores, BranchCentroid } from './store-master-loader';

// In-memory cache for branch centroids
let cachedBranchCentroids: BranchCentroid[] | null = null;

export function invalidateBranchCentroidsCache(): void {
  cachedBranchCentroids = null;
}

async function getBranchCentroids(): Promise<BranchCentroid[]> {
  if (cachedBranchCentroids && cachedBranchCentroids.length > 0) {
    return cachedBranchCentroids;
  }

  const isPortal = (() => {
    try {
      return portalStoresEnabled();
    } catch {
      return false;
    }
  })();

  try {
    const pool = getDbPool();
    const res = await pool.query(`
      SELECT cabang,
             ROUND(AVG(latitude)::numeric, 4) as lat,
             ROUND(AVG(longitude)::numeric, 4) as lon,
             COUNT(*)::int as store_count
      FROM stores
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ${isPortal ? "AND is_active = TRUE AND master_source = 'SPARTA_PORTAL'" : ""}
      GROUP BY cabang
      ORDER BY store_count DESC;
    `);

    if (res.rows && res.rows.length > 0) {
      cachedBranchCentroids = res.rows.map(r => ({
        cabang: r.cabang,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        store_count: r.store_count,
      }));
      return cachedBranchCentroids;
    }
  } catch (error) {
    console.warn('[Autonomous Daemon] DB branch centroids query not available, calculating from master stores:', error);
  }

  // Calculate from master stores dataset (21,550 stores)
  const masterStores = await getOrLoadMasterStores();
  cachedBranchCentroids = getBranchCentroidsFromStores(masterStores);
  return cachedBranchCentroids;
}

/**
 * Autonomous evaluation cycle that runs on the server 24/7
 */
export async function runAutonomousDisasterCycle(): Promise<void> {
  if (isDevelopmentReadOnlyMode()) {
    console.log('[Autonomous Daemon] Blocked in Development Read-Only mode.');
    return;
  }
  if (isCycleRunning || isDaemonStopped) {
    if (isCycleRunning) {
      console.log('[Autonomous Daemon] Previous cycle still running, skipping...');
    }
    return;
  }

  isCycleRunning = true;
  const cycleStart = Date.now();
  let lockClient: PoolClient | null = null;
  let lockAcquired = false;

  try {
    const pool = getDbPool();

    // DB-backed concurrency control: acquire advisory lock on a dedicated client session
    // to guarantee mutual exclusion and prevent lock leakage across connection pool reuse
    try {
      lockClient = await pool.connect();
      const lockRes = await lockClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
      lockAcquired = Boolean(lockRes.rows[0]?.acquired);
    } catch (lockErr) {
      console.warn('[Autonomous Daemon] Advisory lock check warning:', lockErr);
      if (lockClient) {
        lockClient.release();
        lockClient = null;
      }
      lockAcquired = false;
    }

    if (!lockAcquired) {
      if (lockClient) {
        lockClient.release();
        lockClient = null;
      }
      console.log('[Autonomous Daemon] Another worker holds the advisory lock (cycle active). Skipping concurrent cycle.');
      return;
    }

    lastCycleHealth.lastStatus = 'running';
    lastCycleHealth.lastCycleStart = new Date(cycleStart).toISOString();

    // 1. Fetch live earthquakes from BMKG & USGS
    const disasterFeed = await fetchDisasterFeed(true);
    const earthquakes: Earthquake[] = [];
    if (disasterFeed.latestBmkgEarthquake) {
      earthquakes.push(disasterFeed.latestBmkgEarthquake);
    }
    if (disasterFeed.recentEarthquakes && disasterFeed.recentEarthquakes.length > 0) {
      for (const eq of disasterFeed.recentEarthquakes) {
        if (!earthquakes.some(e => e.id === eq.id)) {
          earthquakes.push(eq);
        }
      }
    }

    // 2. Fetch stores from DB or Master CSV (21,550 stores)
    const stores: Store[] = await getOrLoadMasterStores();

    let dispatchedEarthquakeAlerts = 0;
    let dispatchedRainAlerts = 0;

    // 3. Evaluate Earthquakes against 21,550 stores
    // Guard: Do not create new operational alerts if data is stale or unavailable
    const isEligibleForAlert = disasterFeed.dataFreshness !== 'stale' && disasterFeed.dataFreshness !== 'unavailable';

    if (isEligibleForAlert && stores.length > 0 && disasterFeed.activeEarthquakes && disasterFeed.activeEarthquakes.length > 0) {
      const result = await processEarthquakeAlertsAndReports(disasterFeed.activeEarthquakes, stores, isEligibleForAlert);
      dispatchedEarthquakeAlerts = result.dispatchedAlerts;
    }

    // Pending decisions must reach their deadline even when the live feed stops updating.
    const allowSimulation = isSimulationAllowed();
    const pendingEarthquakes = await dbGetPendingEarthquakeEvents();
    if (stores.length && pendingEarthquakes.length) {
      const pending = await processEarthquakeAlertsAndReports(pendingEarthquakes, stores, true, true, allowSimulation);
      dispatchedEarthquakeAlerts += pending.dispatchedAlerts;
    }

    // 4. Automatic weather notifications are disabled by default.
    // Only earthquakes generate automatic operational reports.
    const weatherAlertsEnabled = process.env.SPARTA_AUTONOMOUS_WEATHER_ALERTS === "true";
    const branches = weatherAlertsEnabled ? await getBranchCentroids() : [];
    if (weatherAlertsEnabled && branches.length > 0) {
      try {
        // Query Open-Meteo multi-coordinates for all branch centroids
        const lats = branches.map(b => b.lat).join(',');
        const lons = branches.map(b => b.lon).join(',');
        const weatherUrl = `${getExternalApiConfig().openMeteo.forecastUrl}?latitude=${lats}&longitude=${lons}&current=precipitation,weather_code`;

        const weatherRes = await fetch(weatherUrl, {
          next: { revalidate: 300 },
          headers: { 'User-Agent': 'SpartaSiaga-Daemon/1.0' },
        });

        if (weatherRes.ok) {
          const weatherData = await weatherRes.json();
          const items = Array.isArray(weatherData) ? weatherData : [weatherData];

          for (let i = 0; i < items.length && i < branches.length; i++) {
            const b = branches[i];
            const current = items[i]?.current;
            const precipitation = current?.precipitation ?? 0;
            const weatherCode = current?.weather_code ?? 0;

            // Severe rain threshold: precipitation >= 20 mm/h or severe thunderstorm (code 95, 96, 99)
            if (precipitation >= 20.0 || weatherCode >= 95) {
              const branchKey = b.branch_code || b.cabang;
              const todayStr = new Date().toISOString().slice(0, 10);
              const floodEventId = `flood_${branchKey.toLowerCase()}_${todayStr}`;
              const isProcessed = await hasEventAlreadyBeenProcessed(floodEventId, 'heavy_rain', branchKey);
              const inCooldown = await isNotificationCooldownActive('heavy_rain', branchKey);

              if (!isProcessed && !inCooldown) {
                // Find stores in this branch
                const branchStores = stores
                  .filter(s => (b.branch_code ? (s.branch_code === b.branch_code || s.cabang === b.cabang) : s.cabang === b.cabang))
                  .slice(0, 10)
                  .map(s => ({
                    kode_toko: s.kode_toko,
                    nama_toko: s.nama_toko,
                    cabang: s.cabang,
                    distance_km: 1.0,
                    status: 'MONITOR' as const,
                    alamat: s.alamat,
                    fr_type: s.fr_type,
                  }));

                const ticketNumber = `FL-${branchKey.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
                const rainTitle = `SIAGA HUJAN LEBAT - POTENSI BANJIR: Cabang ${b.cabang}`;
                const rainMessage = `Model cuaca menunjukkan potensi curah hujan lebat (${precipitation.toFixed(1)} mm/jam) di sekitar cabang ${b.cabang}. Bersiap aktifkan SOP pencegahan genangan.`;

                await recordNotificationLog({
                  disasterId: floodEventId,
                  disasterType: 'heavy_rain',
                  channel: 'pwa_only',
                  branch: branchKey,
                  recipientContact: `pwa://dc-${branchKey.toLowerCase()}`,
                  title: rainTitle,
                  message: rainMessage,
                  affectedStores: branchStores,
                  ticketNumber,
                });

                dispatchedRainAlerts++;
                console.log(`[Autonomous Daemon] 🌧️ DISPATCHED FLOOD ALERT: Cabang ${b.cabang} (Precipitation: ${precipitation} mm/h)`);
              }
            }
          }
        }
      } catch (weatherErr) {
        console.warn('[Autonomous Daemon] Warning evaluating weather across branches:', weatherErr);
      }
    }

    // 5. Automatic Report Expiration and 24h Reminder Evaluation
    try {
      const { processReportLifecycles } = await import('./report-lifecycle-service');
      await processReportLifecycles();
    } catch (lifecycleErr) {
      console.warn('[Autonomous Daemon] Warning evaluating report lifecycles:', lifecycleErr);
    }

    const elapsed = Date.now() - cycleStart;
    lastCycleHealth.lastCycleFinished = new Date().toISOString();
    lastCycleHealth.lastCycleDurationMs = elapsed;
    lastCycleHealth.lastDisasterCount = earthquakes.length;
    lastCycleHealth.lastBranchesCount = branches.length;
    lastCycleHealth.lastDispatchedEarthquakeAlerts = dispatchedEarthquakeAlerts;
    lastCycleHealth.lastDispatchedRainAlerts = dispatchedRainAlerts;
    lastCycleHealth.lastStatus = 'healthy';
    lastCycleHealth.lastError = null;

    console.log(
      `[Autonomous Daemon] Cycle finished in ${elapsed}ms | Quakes evaluated: ${earthquakes.length} | Branches checked: ${branches.length} | Dispatches: ${dispatchedEarthquakeAlerts} EQ, ${dispatchedRainAlerts} Flood`
    );

  } catch (error: any) {
    console.error('[Autonomous Daemon] Fatal error during cycle:', error);
    lastCycleHealth.lastStatus = 'error';
    lastCycleHealth.lastError = error?.message || String(error);
  } finally {
    if (lockClient) {
      if (lockAcquired) {
        try {
          await lockClient.query('SELECT pg_advisory_unlock($1)', [WORKER_DISASTER_ADVISORY_LOCK_ID]);
        } catch (unlockErr) {
          console.warn('[Autonomous Daemon] Advisory unlock warning:', unlockErr);
        }
      }
      try {
        lockClient.release();
      } catch {
        // ignore client release error
      }
      lockClient = null;
    }
    isCycleRunning = false;
  }
}

/**
 * Checks if a store sync is due based on STORE_SYNC_INTERVAL_HOURS
 */
export async function isStoreSyncDue(options?: { pool?: Pool }): Promise<boolean> {
  try {
    let usePortal = false;
    try {
      usePortal = portalStoresEnabled();
    } catch (err) {
      if (err instanceof SpartaIntegrationError) {
        return false;
      }
      throw err;
    }
    const lastSync = await getLastStoreSyncHistory({
      onlyCompleted: true,
      source: usePortal ? "SPARTA_PORTAL" : "LEGACY",
      pool: options?.pool,
    });
    if (!lastSync || !lastSync.completed_at) return true;
    const elapsedMs = Date.now() - new Date(lastSync.completed_at).getTime();
    return elapsedMs >= STORE_SYNC_INTERVAL_MS;
  } catch {
    return true;
  }
}

/**
 * Executes an autonomous background store sync cycle
 */
export async function runAutonomousStoreSyncCycle(
  force: boolean = false,
  options?: { pool?: Pool; fetchFn?: typeof fetch }
): Promise<{
  success: boolean;
  status: string;
  record?: StoreSyncHistoryRecord;
  error?: string;
}> {
  if (isDevelopmentReadOnlyMode()) {
    return {
      success: false,
      status: "READ_ONLY_BLOCKED",
      error: "Autonomous store sync is blocked in Development Read-Only mode",
    };
  }
  if (isStoreSyncRunning || isDaemonStopped) {
    return { success: false, status: "ALREADY_RUNNING", error: "Store sync cycle already in progress or daemon stopped" };
  }

  try {
    portalStoresEnabled();
  } catch (err) {
    if (err instanceof SpartaIntegrationError) {
      return { success: false, status: "CONVERSION_DISABLED", error: err.message };
    }
    throw err;
  }

  const due = force || (await isStoreSyncDue({ pool: options?.pool }));
  if (!due || isDaemonStopped) {
    return { success: true, status: isDaemonStopped ? "STOPPED" : "NOT_DUE" };
  }

  const pool = options?.pool || getDbPool();
  let lockClient: PoolClient | null = null;
  let lockAcquired = false;

  try {
    if (typeof pool.connect === "function") {
      lockClient = await pool.connect();
      const lockRes = await lockClient.query<{ acquired?: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [WORKER_STORE_SYNC_ADVISORY_LOCK_ID]
      );
      if (lockRes.rows.length > 0 && lockRes.rows[0]?.acquired === false) {
        lockClient.release();
        lockClient = null;
        return {
          success: false,
          status: "ALREADY_RUNNING",
          error: "Another worker holds the store sync advisory lock",
        };
      }
      lockAcquired = Boolean(lockRes.rows[0]?.acquired);
    }
  } catch (lockErr) {
    console.warn("[Autonomous Store Sync] Advisory lock check warning:", lockErr);
    if (lockClient) {
      lockClient.release();
      lockClient = null;
    }
  }

  isStoreSyncRunning = true;
  console.log("[Autonomous Store Sync] Starting periodic store sync cycle...");
  try {
    const record = await syncMasterStores({
      pool: options?.pool,
      fetchFn: options?.fetchFn,
    });
    invalidateBranchCentroidsCache();
    console.log(
      `[Autonomous Store Sync] Cycle completed with status: ${record.status} (${record.records_added} added, ${record.records_updated} updated)`
    );
    return { success: true, status: record.status, record };
  } catch (err: any) {
    console.error("[Autonomous Store Sync] Cycle failed with error:", err);
    return { success: false, status: "FAILED", error: err.message };
  } finally {
    isStoreSyncRunning = false;
    if (lockClient) {
      if (lockAcquired) {
        try {
          await lockClient.query("SELECT pg_advisory_unlock($1)", [WORKER_STORE_SYNC_ADVISORY_LOCK_ID]);
        } catch (unlockErr) {
          console.warn("[Autonomous Store Sync] Advisory unlock warning:", unlockErr);
        }
      }
      try {
        lockClient.release();
      } catch {
        // ignore client release error
      }
      lockClient = null;
    }
  }
}

/**
 * Returns the current daemon store sync status
 */
export async function getStoreSyncStatus(): Promise<{
  isRunning: boolean;
  intervalHours: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  sourceType: string | null;
  activeSource: "SPARTA_PORTAL" | "LEGACY";
}> {
  const usePortal = (() => {
    try {
      return portalStoresEnabled();
    } catch {
      return false;
    }
  })();
  const lastSync = await getLastStoreSyncHistory();
  return {
    isRunning: isStoreSyncRunning,
    intervalHours: STORE_SYNC_INTERVAL_HOURS,
    lastSyncAt: lastSync?.completed_at || lastSync?.started_at || null,
    lastSyncStatus: lastSync?.status || null,
    sourceType: lastSync?.sourceType || null,
    activeSource: usePortal ? "SPARTA_PORTAL" : "LEGACY",
  };
}

/**
 * Start the autonomous daemon (Ensures single runner in Node.js server process)
 */
export function startServerDaemon(): void {
  if (typeof window !== "undefined") return; // Server only
  if (isDevelopmentReadOnlyMode()) {
    console.warn("[Autonomous Daemon] Startup blocked in Development Read-Only mode.");
    return;
  }

  const globalScope = globalThis as any;
  if (globalScope.__sparta_daemon_started) {
    console.log("[Autonomous Daemon] Daemon already active in this Node.js process.");
    return;
  }

  globalScope.__sparta_daemon_started = true;
  isDaemonStopped = false;
  const storeSourceDesc = (() => {
    try {
      return portalStoresEnabled() ? "Portal SPARTA" : "Google Sheets / Master Toko";
    } catch {
      return "Master Toko (Portal terblokir sebelum konversi cabang)";
    }
  })();
  console.log("------------------------------------------------------------");
  console.log("🚀 [SPARTA SIAGA] 24/7 AUTONOMOUS SERVER DAEMON ACTIVATED");
  console.log("   Continuous monitoring: BMKG Quakes (60s), RainViewer & Open-Meteo");
  console.log(`   Periodic store sync: Scheduled every ${STORE_SYNC_INTERVAL_HOURS}h (${storeSourceDesc})`);
  console.log("   Auto-dispatching: Email to DC Cabang + PWA Push Notifications");
  console.log("------------------------------------------------------------");

  // Initial disaster trigger after 4 seconds
  initialTimer = setTimeout(() => {
    if (isDaemonStopped) return;
    runAutonomousDisasterCycle().catch((err) => console.error("[Autonomous Daemon] Initial run failed:", err));
  }, 4000);

  // Interval disaster trigger every 60 seconds (1 minute) 24/7
  intervalTimer = setInterval(() => {
    if (isDaemonStopped) return;
    runAutonomousDisasterCycle().catch((err) => console.error("[Autonomous Daemon] Interval run failed:", err));
  }, 60000);

  // Initial store sync check after 10 seconds
  storeSyncInitialTimer = setTimeout(() => {
    if (isDaemonStopped) return;
    runAutonomousStoreSyncCycle().catch((err) =>
      console.error("[Autonomous Store Sync] Initial check failed:", err)
    );
  }, 10000);

  // Periodic store sync check every 1 hour (evaluates if 24 hours elapsed)
  storeSyncIntervalTimer = setInterval(() => {
    if (isDaemonStopped) return;
    runAutonomousStoreSyncCycle().catch((err) =>
      console.error("[Autonomous Store Sync] Periodic interval check failed:", err)
    );
  }, 60 * 60 * 1000);
}

export async function stopServerDaemon(gracePeriodMs: number = 5000): Promise<void> {
  isDaemonStopped = true;
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (storeSyncInitialTimer) {
    clearTimeout(storeSyncInitialTimer);
    storeSyncInitialTimer = null;
  }
  if (storeSyncIntervalTimer) {
    clearInterval(storeSyncIntervalTimer);
    storeSyncIntervalTimer = null;
  }
  const globalScope = globalThis as any;
  globalScope.__sparta_daemon_started = false;

  const start = Date.now();
  while ((isCycleRunning || isStoreSyncRunning) && Date.now() - start < gracePeriodMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  console.log("[Autonomous Daemon] Daemon stopped.");
}

/**
 * Evaluates active earthquakes against stores, sends branch alerts,
 * and creates store-level incident reports for stores in the priority zone.
 */
export async function processEarthquakeAlertsAndReports(
  earthquakes: Earthquake[],
  stores: Store[],
  isEligibleForAlert: boolean = true,
  allowBackfill: boolean = false,
  allowSimulation: boolean = false
): Promise<{ dispatchedAlerts: number; createdReports: number }> {
  if (isDevelopmentReadOnlyMode()) {
    return { dispatchedAlerts: 0, createdReports: 0 };
  }
  let dispatchedAlerts = 0;
  let createdReports = 0;

  if (!isEligibleForAlert || !earthquakes.length || !stores.length) {
    return { dispatchedAlerts: 0, createdReports: 0 };
  }

  for (const eq of earthquakes) {
    // CRITICAL EARTHQUAKE DATA INTEGRITY GUARD:
    // Only official, genuine earthquakes from verified agency providers (BMKG or USGS)
    // are permitted to trigger automatic store reports or branch emergency notifications.
    const source = (eq.source || eq.sourcePrimary || "").toUpperCase();
    const isOfficialProvider = source === "BMKG" || source === "USGS";
    const isSyntheticOrTest = Boolean(
      (eq.id && /test|simul|uji|demo|p2_test/i.test(eq.id)) ||
      (eq.title && /test|simul|uji|demo/i.test(eq.title)) ||
      ((eq as any).provider_event_id && /test|simul|uji|demo/i.test((eq as any).provider_event_id))
    );

    const simulationAuthorized = allowSimulation && isSimulationAllowed();

    if ((!isOfficialProvider || isSyntheticOrTest) && !simulationAuthorized) {
      console.warn(`[Daemon Alert Guard] Ignored non-official/synthetic earthquake from production alert evaluation: ID=${eq.id}, Title="${eq.title}", Source="${source}"`);
      continue;
    }

    const eventTimestamp = eq.timestamp || (eq.time ? new Date(eq.time).getTime() : Date.now());
    const eventAgeMinutes = (Date.now() - eventTimestamp) / (1000 * 60);

    // If backfill is not requested, strictly enforce the 60-minute freshness cutoff for report creation and alerts
    if (!allowBackfill && eventAgeMinutes > AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES) {
      continue;
    }

    // Bounded backfill: events older than AUTO_EARTHQUAKE_BACKFILL_MAX_AGE_MINUTES (default 24h = 1440m)
    // are strictly excluded to avoid treating all 72-hour map monitoring events as new incidents.
    if (eventAgeMinutes > AUTO_EARTHQUAKE_BACKFILL_MAX_AGE_MINUTES) {
      continue;
    }

    // Guarantee canonical event recording in earthquake_events table
    await dbUpsertEarthquakeEvent(eq);

    // Operational decision revised on 6 November 2026:
    // Magnitude below 4.0: display only; do not trigger this automatic inspection workflow.
    if (eq.magnitude < 4.0) {
      console.log(`[Autonomous Daemon] Earthquake ${eq.id} (M ${eq.magnitude} < 4.0): Recorded for display only; automatic inspection workflow suppressed.`);
      continue;
    }

    try {
      const result = await executeEarthquakeV1MmiWorkflow({ earthquake: eq, stores });
      dispatchedAlerts += result.dispatchedBranchNotifications;
      createdReports += result.createdInspectionReports;
    } catch (error) {
      console.error(`[Autonomous Daemon] V1 + MMI assessment deferred for ${eq.id}:`, error);
    }
  }

return { dispatchedAlerts, createdReports };
}

