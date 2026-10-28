// Explicit global marker tracking whether this module has been evaluated in the current Node process
(globalThis as Record<string, unknown>).__sparta_server_daemon_module_loaded = true;

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { getDbPool } from './db';
import { fetchDisasterFeed } from './disaster-service';
import { calculateHaversineDistance, calculateSpartaMonitoringZone } from './haversine';
import { dbUpsertEarthquakeEvent } from './earthquake-db';
import { ensureEarthquakeReport } from './earthquake-report-service';
import { 
  hasEventAlreadyBeenProcessed,
  isNotificationCooldownActive,
  recordNotificationLog, 
  updateNotificationLogForEvent,
  generateEmergencyEmailHtml 
} from './notification-service';
import { 
  dbFindAutoEarthquakeReport, 
  dbFindManualEarthquakeReportByEvent, 
  dbFindUnlinkedManualEarthquakeCandidates,
  dbCreateIncident, 
  dbUpdateIncident 
} from './incident-db';
import { AffectedStoreSummary } from '@/types/notification';
import { ReportAffectedStore } from '@/types/incident';
import { Store } from '@/types/store';
import { Earthquake } from '@/types/disaster';
import { dispatchEarthquakePushNotifications } from './web-push-service';
import { getExternalApiConfig } from './runtime-config';

import { 
  syncStoresFromGoogleSheets, 
  getLastStoreSyncHistory, 
  StoreSyncHistoryRecord 
} from './google-sheets-sync';

export const AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES = parseInt(process.env.AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES || '60', 10);
export const AUTO_EARTHQUAKE_BACKFILL_MAX_AGE_MINUTES = parseInt(process.env.AUTO_EARTHQUAKE_BACKFILL_MAX_AGE_MINUTES || '1440', 10);
export const AUTO_EARTHQUAKE_MAX_AGE_MINUTES = AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES;
export const MANUAL_EARTHQUAKE_MATCH_WINDOW_MINUTES = parseInt(process.env.MANUAL_EARTHQUAKE_MATCH_WINDOW_MINUTES || '120', 10);
export const STORE_SYNC_INTERVAL_HOURS = parseInt(process.env.STORE_SYNC_INTERVAL_HOURS || '24', 10);
export const STORE_SYNC_INTERVAL_MS = STORE_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
export const WORKER_DISASTER_ADVISORY_LOCK_ID = 7421840;

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

async function getBranchCentroids(): Promise<BranchCentroid[]> {
  if (cachedBranchCentroids && cachedBranchCentroids.length > 0) {
    return cachedBranchCentroids;
  }

  try {
    const pool = getDbPool();
    const res = await pool.query(`
      SELECT cabang, 
             ROUND(AVG(latitude)::numeric, 4) as lat, 
             ROUND(AVG(longitude)::numeric, 4) as lon,
             COUNT(*)::int as store_count
      FROM stores 
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
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
              const todayStr = new Date().toISOString().slice(0, 10);
              const floodEventId = `flood_${b.cabang.toLowerCase()}_${todayStr}`;
              const isProcessed = await hasEventAlreadyBeenProcessed(floodEventId, 'heavy_rain', b.cabang);
              const inCooldown = await isNotificationCooldownActive('heavy_rain', b.cabang);

              if (!isProcessed && !inCooldown) {
                // Find stores in this branch
                const branchStores = stores.filter(s => s.cabang === b.cabang).slice(0, 10).map(s => ({
                  kode_toko: s.kode_toko,
                  nama_toko: s.nama_toko,
                  cabang: s.cabang,
                  distance_km: 1.0,
                  status: 'MONITOR' as const,
                  alamat: s.alamat,
                  fr_type: s.fr_type,
                }));

                const ticketNumber = `FL-${b.cabang.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
                const rainTitle = `SIAGA HUJAN LEBAT — POTENSI BANJIR: Cabang ${b.cabang}`;
                const rainMessage = `Model cuaca menunjukkan potensi curah hujan lebat (${precipitation.toFixed(1)} mm/jam) di sekitar cabang ${b.cabang}. Bersiap aktifkan SOP pencegahan genangan.`;

                await recordNotificationLog({
                  disasterId: floodEventId,
                  disasterType: 'heavy_rain',
                  channel: 'pwa_only',
                  branch: b.cabang,
                  recipientContact: `pwa://dc-${b.cabang.toLowerCase()}`,
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
export async function isStoreSyncDue(): Promise<boolean> {
  try {
    const lastSync = await getLastStoreSyncHistory();
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
export async function runAutonomousStoreSyncCycle(force: boolean = false): Promise<{
  success: boolean;
  status: string;
  record?: StoreSyncHistoryRecord;
  error?: string;
}> {
  if (isStoreSyncRunning || isDaemonStopped) {
    return { success: false, status: "ALREADY_RUNNING", error: "Store sync cycle already in progress or daemon stopped" };
  }

  const due = force || (await isStoreSyncDue());
  if (!due || isDaemonStopped) {
    return { success: true, status: isDaemonStopped ? "STOPPED" : "NOT_DUE" };
  }

  isStoreSyncRunning = true;
  console.log("[Autonomous Store Sync] Starting periodic store sync cycle...");
  try {
    const record = await syncStoresFromGoogleSheets();
    console.log(
      `[Autonomous Store Sync] Cycle completed with status: ${record.status} (${record.records_added} added, ${record.records_updated} updated)`
    );
    return { success: true, status: record.status, record };
  } catch (err: any) {
    console.error("[Autonomous Store Sync] Cycle failed with error:", err);
    return { success: false, status: "FAILED", error: err.message };
  } finally {
    isStoreSyncRunning = false;
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
}> {
  const lastSync = await getLastStoreSyncHistory();
  return {
    isRunning: isStoreSyncRunning,
    intervalHours: STORE_SYNC_INTERVAL_HOURS,
    lastSyncAt: lastSync?.completed_at || lastSync?.started_at || null,
    lastSyncStatus: lastSync?.status || null,
    sourceType: lastSync?.sourceType || null,
  };
}

/**
 * Start the autonomous daemon (Ensures single runner in Node.js server process)
 */
export function startServerDaemon(): void {
  if (typeof window !== "undefined") return; // Server only

  const globalScope = globalThis as any;
  if (globalScope.__sparta_daemon_started) {
    console.log("[Autonomous Daemon] Daemon already active in this Node.js process.");
    return;
  }

  globalScope.__sparta_daemon_started = true;
  isDaemonStopped = false;
  console.log("------------------------------------------------------------");
  console.log("🚀 [SPARTA SIAGA] 24/7 AUTONOMOUS SERVER DAEMON ACTIVATED");
  console.log("   Continuous monitoring: BMKG Quakes (60s), RainViewer & Open-Meteo");
  console.log(`   Periodic store sync: Scheduled every ${STORE_SYNC_INTERVAL_HOURS}h (Google Sheets / Master Toko)`);
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
  allowBackfill: boolean = false
): Promise<{ dispatchedAlerts: number; createdReports: number }> {
  let dispatchedAlerts = 0;
  let createdReports = 0;

  if (!isEligibleForAlert || !earthquakes.length || !stores.length) {
    return { dispatchedAlerts: 0, createdReports: 0 };
  }

  for (const eq of earthquakes) {
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

    // Outdated emergency alerts are strictly prevented for events older than 60m.
    const isAlertEligible = isEligibleForAlert && (eventAgeMinutes <= AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES);
    const isBackfill = eventAgeMinutes > AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES;

    // Guarantee canonical event recording in earthquake_events table
    await dbUpsertEarthquakeEvent(eq);

    const { priorityRadiusKm, monitoringRadiusKm } = calculateSpartaMonitoringZone(eq.magnitude, eq.depthKm);

    // 1. Evaluate Active Verified Facilities (DCs, Warehouses, Regional Offices)
    let activeFacilities: Array<{
      id: string;
      code: string;
      name: string;
      facility_type: string;
      branch_id: string | null;
      latitude: number | null;
      longitude: number | null;
      operational_status?: string;
      auto_report_enabled?: boolean;
      mapping_verified_at?: string | null;
    }> = [];

    try {
      const pool = getDbPool();
      const facRes = await pool.query(
        `SELECT id::text, code, name, facility_type, branch_id, latitude, longitude,
                operational_status, auto_report_enabled, mapping_verified_at
           FROM facilities`
      );
      activeFacilities = facRes.rows || [];
    } catch {
      // In offline or non-DB testing
    }

    const affectedFacilitiesByBranch = new Map<string, AffectedStoreSummary[]>();

    for (const facility of activeFacilities) {
      if (
        facility.latitude == null ||
        facility.longitude == null ||
        !Number.isFinite(Number(facility.latitude)) ||
        !Number.isFinite(Number(facility.longitude))
      ) {
        continue;
      }

      const distanceKm = calculateHaversineDistance(
        eq.latitude,
        eq.longitude,
        Number(facility.latitude),
        Number(facility.longitude)
      );

      if (isNaN(distanceKm) || distanceKm > monitoringRadiusKm) continue;

      const branchKey = facility.branch_id?.trim();
      if (!branchKey) {
        console.warn(`[Autonomous Daemon] Unmapped facility detected: ${facility.code} (${facility.name}) has no operational branch mapping. Flagging and excluding from branch-specific notification dispatch.`);
        continue;
      }

      const isVerifiedActive =
        facility.operational_status === 'ACTIVE' &&
        facility.auto_report_enabled === true &&
        Boolean(facility.mapping_verified_at);

      if (!isVerifiedActive) continue;

      const facilityStatus = distanceKm <= priorityRadiusKm ? 'PRIORITY_MONITOR' : 'MONITOR';
      const facilitySummary: AffectedStoreSummary = {
        kode_toko: facility.code,
        nama_toko: facility.name,
        cabang: branchKey,
        distance_km: Math.round(distanceKm * 10) / 10,
        status: facilityStatus,
        fr_type: facility.facility_type,
      };

      if (!affectedFacilitiesByBranch.has(branchKey)) {
        affectedFacilitiesByBranch.set(branchKey, []);
      }
      affectedFacilitiesByBranch.get(branchKey)!.push(facilitySummary);

      if (distanceKm <= priorityRadiusKm) {
        const reportHash = crypto
          .createHash('sha256')
          .update(`${eq.id}:FACILITY:${facility.id}`)
          .digest('hex')
          .slice(0, 16)
          .toUpperCase();

        try {
          const res = await ensureEarthquakeReport({
            reportId: `LAP-EQ-FAC-${reportHash}`,
            canonicalEventId: eq.id,
            eventOccurredAt: new Date(eventTimestamp),
            source: eq.source || 'BMKG/USGS',
            location: {
              kind: 'FACILITY',
              id: facility.id,
              code: facility.code,
              name: facility.name,
              type: facility.facility_type,
              branch: branchKey,
              latitude: Number(facility.latitude),
              longitude: Number(facility.longitude),
            },
          });
          if (res.outcome === 'created') {
            createdReports++;
            console.log(`[Autonomous Daemon] Auto-report created: LAP-EQ-FAC-${reportHash} for facility ${facility.code} (${facility.name})`);
          }
        } catch (facReportErr) {
          console.error(`[Autonomous Daemon] Error creating report for facility ${facility.code}:`, facReportErr);
        }
      }
    }

    if (isAlertEligible) {
      for (const [branch, facilities] of affectedFacilitiesByBranch) {
        facilities.sort((a, b) => a.distance_km - b.distance_km);
        const priorityCount = facilities.filter((item) => item.status === 'PRIORITY_MONITOR').length;
        if (priorityCount > 0) {
          try {
            await recordNotificationLog({
              disasterId: eq.id,
              canonicalEventId: eq.id,
              disasterType: 'earthquake',
              channel: 'pwa_only',
              branch,
              recipientGroup: 'BES',
              category: 'ASSIGNMENT',
              recipientContact: `in-app://bes/${branch.toLowerCase().replace(/\s+/g, '-')}`,
              title: `Pemeriksaan fasilitas · Gempa M ${eq.magnitude}`,
              message: `${facilities.length} fasilitas perlu diperiksa; ${priorityCount} berada di Zona Prioritas Pantau. Buka Shared Queue untuk mengambil PIC.`,
              affectedStores: facilities,
            });
          } catch (besErr) {
            console.warn('[Autonomous Daemon] Error recording BES notification log:', besErr);
          }
        }
      }
    }

    // 2. Evaluate Stores (21,550 master stores)
    const branchStoresMap = new Map<string, AffectedStoreSummary[]>();
    const priorityStoresByBranch = new Map<string, AffectedStoreSummary[]>();

    for (const store of stores) {
      if (store.latitude == null || store.longitude == null) continue;
      const distance = calculateHaversineDistance(eq.latitude, eq.longitude, store.latitude, store.longitude);

      if (distance <= priorityRadiusKm) {
        const affected: AffectedStoreSummary = {
          kode_toko: store.kode_toko,
          nama_toko: store.nama_toko,
          cabang: store.cabang,
          distance_km: distance,
          status: 'PRIORITY_MONITOR',
          alamat: store.alamat,
          fr_type: store.fr_type,
        };
        if (!branchStoresMap.has(store.cabang)) branchStoresMap.set(store.cabang, []);
        branchStoresMap.get(store.cabang)!.push(affected);

        if (!priorityStoresByBranch.has(store.cabang)) priorityStoresByBranch.set(store.cabang, []);
        priorityStoresByBranch.get(store.cabang)!.push(affected);
      } else if (distance <= monitoringRadiusKm) {
        const affected: AffectedStoreSummary = {
          kode_toko: store.kode_toko,
          nama_toko: store.nama_toko,
          cabang: store.cabang,
          distance_km: distance,
          status: 'MONITOR',
          alamat: store.alamat,
          fr_type: store.fr_type,
        };
        if (!branchStoresMap.has(store.cabang)) branchStoresMap.set(store.cabang, []);
        branchStoresMap.get(store.cabang)!.push(affected);
      }
    }

    for (const [branch, branchStores] of branchStoresMap.entries()) {
      const priorityStores = priorityStoresByBranch.get(branch) || [];

      // Branch DC Notification (Email & PWA alert log)
      // Only dispatch emergency alert if event is fresh (<= 60m); suppress during downtime recovery
      if (isAlertEligible) {
        const isProcessed = await hasEventAlreadyBeenProcessed(eq.id, 'earthquake', branch);
        const inCooldown = await isNotificationCooldownActive('earthquake', branch);

        branchStores.sort((a, b) => a.distance_km - b.distance_km);
        const disasterTitle = `⚠️ PERINGATAN DARURAT GEMPA M ${eq.magnitude} - CABANG ${branch.toUpperCase()}`;
        const disasterDetail = `Gempa bumi tektonik terdeteksi oleh BMKG/USGS dengan Magnitudo ${eq.magnitude} pada kedalaman ${eq.depthKm} km di wilayah ${eq.title}. Zona Prioritas Pantau SPARTA terhitung ${priorityRadiusKm} km. ${priorityStores.length} gerai toko cabang Anda berada di Zona Prioritas Pantau SPARTA.`;

        if (isProcessed) {
          await updateNotificationLogForEvent(eq.id, branch, {
            title: disasterTitle,
            message: disasterDetail,
            affectedStores: branchStores,
          });
        } else if (!inCooldown) {
          const ticketNumber = `ESC-${branch.substring(0, 3).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
          const instructions = [
            'Duty Officer DC Cabang segera melakukan panggilan radio/telepon siaga ke Area Coordinator (AC) terkait.',
            'Instruksikan personil toko melakukan evakuasi pelanggan dan kru jika struktur bangunan menunjukkan keretakan.',
            'Matikan aliran listrik utama (MCB) dan amankan tabung gas jika tercium bau kebocoran.',
            'Laporkan status operasional (Buka / Tutup Sementara / Kerusakan) melalui Command Center SPARTA.',
          ];

          generateEmergencyEmailHtml({
            ticketNumber,
            branch,
            disasterTitle,
            disasterDetail,
            affectedCount: branchStores.length,
            stores: branchStores,
            instructions,
            sentAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
          });

          await recordNotificationLog({
            disasterId: eq.id,
            disasterType: 'earthquake',
            channel: 'email_and_pwa',
            branch,
            recipientContact: `dc.${branch.toLowerCase().replace(/\s+/g, '')}@alfamart.co.id`,
            title: disasterTitle,
            message: disasterDetail,
            affectedStores: branchStores,
            ticketNumber,
          });

          // Deliver real background Web Push to registered PWA devices (Android, iOS PWA, Desktop)
          await dispatchEarthquakePushNotifications({
            title: disasterTitle,
            body: disasterDetail,
            branch,
            eventId: eq.id,
            magnitude: eq.magnitude,
            priorityStoresCount: priorityStores.length,
            url: `/monitoring?disasterId=${encodeURIComponent(eq.id)}`,
          }).catch((pushErr) => {
            console.error('[Autonomous Daemon] Error during background Web Push dispatch:', pushErr);
          });

          dispatchedAlerts++;
        }
      } else {
        console.log(`[Autonomous Daemon] Suppressed outdated emergency alert for event ${eq.id} at branch ${branch} (event age: ${eventAgeMinutes.toFixed(1)}m > ${AUTO_EARTHQUAKE_ALERT_MAX_AGE_MINUTES}m)`);
      }

      // Operational Reports for stores in Priority Monitoring Zone
      for (const store of priorityStores) {
        const existingAuto = await dbFindAutoEarthquakeReport(eq.id, store.kode_toko, branch);
        if (existingAuto) {
          await dbUpdateIncident(existingAuto.id, {
            earthquakeSource: eq.source || 'BMKG/USGS',
            disasterMetadata: {
              magnitude: eq.magnitude,
              depth: eq.depth,
              coordinates: [eq.latitude, eq.longitude],
              place: eq.title,
              time: eq.time,
            },
          });
          continue;
        }

        const existingManual = await dbFindManualEarthquakeReportByEvent(eq.id, store.kode_toko, branch);
        if (existingManual) {
          continue;
        }

        const unlinkedCandidates = await dbFindUnlinkedManualEarthquakeCandidates(
          store.kode_toko,
          eventTimestamp,
          MANUAL_EARTHQUAKE_MATCH_WINDOW_MINUTES
        );
        if (unlinkedCandidates.length === 1) {
          const candidate = unlinkedCandidates[0];
          await dbUpdateIncident(candidate.id, {
            earthquakeEventId: eq.id,
            earthquakeSource: eq.source || 'BMKG/USGS',
            earthquakeProvenance: `Ditautkan otomatis ke event ${eq.source || 'BMKG/USGS'} ${eq.id} (jendela ${MANUAL_EARTHQUAKE_MATCH_WINDOW_MINUTES}m)`,
            disasterMetadata: {
              magnitude: eq.magnitude,
              depth: eq.depth,
              coordinates: [eq.latitude, eq.longitude],
              place: eq.title,
              time: eq.time,
            },
          });
          continue;
        } else if (unlinkedCandidates.length > 1) {
          console.warn(`[Autonomous Daemon] Ambiguous unlinked manual reports found for Store ${store.kode_toko}. Skipping auto-report.`);
          continue;
        }

        const randSuffix = Math.floor(1000 + Math.random() * 9000);
        const reportId = `LAP-EQ-${store.kode_toko.toUpperCase()}-${randSuffix}`;
        const todayStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

        const reportAffectedStores: ReportAffectedStore[] = [{
          kode_toko: store.kode_toko,
          nama_toko: store.nama_toko,
          cabang: store.cabang,
          alamat: store.alamat,
          fr_type: store.fr_type,
          distance_km: store.distance_km,
          exposure_zone: 'PRIORITY_MONITOR',
          confirmation_status: 'pending',
        }];

        try {
          const createdIncident = await dbCreateIncident({
            id: reportId,
            date: todayStr,
            disasterType: 'earthquake',
            reportOrigin: 'automatic_earthquake',
            earthquakeEventId: eq.id,
            canonicalEventId: eq.id,
            locationKind: 'STORE',
            locationId: store.kode_toko,
            locationCodeSnapshot: store.kode_toko,
            locationNameSnapshot: store.nama_toko,
            locationTypeSnapshot: store.fr_type || 'Reguler',
            latitudeSnapshot: store.latitude,
            longitudeSnapshot: store.longitude,
            branchSnapshot: branch,
            earthquakeSource: eq.source || 'BMKG/USGS',
            earthquakeProvenance: isBackfill
              ? `Estimasi area dampak berdasarkan data gempa ${eq.source || 'BMKG/USGS'} dan perhitungan SPARTA (Pemulihan pasca-downtime, usia event: ${Math.round(eventAgeMinutes)}m).`
              : `Estimasi area dampak berdasarkan data gempa ${eq.source || 'BMKG/USGS'} dan perhitungan SPARTA.`,
            tkpType: 'toko',
            storeId: store.kode_toko,
            storeName: store.nama_toko,
            branch,
            locationCity: branch,
            status: 'pending_confirmation',
            progress: 0,
            disasterMetadata: {
              magnitude: eq.magnitude,
              depth: eq.depth,
              coordinates: [eq.latitude, eq.longitude],
              place: eq.title,
              time: eq.time,
            },
            affectedStores: reportAffectedStores,
            affectedStoreCount: 1,
            dangerStoreCount: 1,
            fieldPhotos: [],
            timeline: [
              {
                stage: isBackfill ? 'Laporan Otomatis Di-backfill (Pasca-Downtime)' : 'Laporan Otomatis Dibuat',
                label: isBackfill
                  ? `Laporan gempa dipulihkan pasca-downtime (usia event ${Math.round(eventAgeMinutes)} menit). Gerai ${store.nama_toko} (${store.kode_toko}) berada dalam radius zona prioritas (${store.distance_km.toFixed(1)} km) dan memerlukan konfirmasi lapangan.`
                  : `Gempa M${eq.magnitude} terdeteksi oleh ${eq.source || 'BMKG/USGS'}. Gerai ${store.nama_toko} (${store.kode_toko}) berada dalam radius zona prioritas pantau (${store.distance_km.toFixed(1)} km) dan memerlukan konfirmasi kondisi lapangan.`,
                timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
                actor: 'SPARTA Siaga — Autonomous Engine',
                notes: `Event ID: ${eq.id}`,
              },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          if (createdIncident.id === reportId) {
            createdReports++;
            console.log(`[Autonomous Daemon] Auto-report created: ${reportId} for store ${store.kode_toko}${isBackfill ? ' (Downtime Recovery Backfill)' : ''}`);
          } else {
            console.log(`[Autonomous Daemon] Existing report found on race condition for store ${store.kode_toko} / event ${eq.id}: ${createdIncident.id}`);
          }
        } catch (err: unknown) {
          const pgError = err as { code?: string };
          if (pgError?.code === '23505') {
            console.log(`[Autonomous Daemon] Unique constraint caught duplicate insert for Store ${store.kode_toko} / Event ${eq.id}`);
          } else {
            console.error(`[Autonomous Daemon] Failed to create incident report for Store ${store.kode_toko}:`, err);
          }
        }
      }
    }
  }

  return { dispatchedAlerts, createdReports };
}

