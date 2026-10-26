import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { fetchDisasterFeed } from '@/lib/disaster-service';
import { Store } from '@/types/store';
import { NotificationLog } from '@/types/notification';
import { recordNotificationLog } from '@/lib/notification-service';
import { getDbPool } from '@/lib/db';
import { processEarthquakeAlertsAndReports, getDisasterCycleHealth } from '@/lib/server-daemon';
import { getOrLoadMasterStores } from '@/lib/store-master-loader';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

let isWorkerRunning = false;
let lastWorkerRunTime = 0;
const WORKER_COOLDOWN_MS = 30000;

function validateInternalWorkerSecret(request: Request, secret: string): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  
  const token = authHeader.substring(7);
  if (token.length !== secret.length) return false;
  
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = process.env.SPARTA_INTERNAL_WORKER_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: 'Server misconfiguration' }, { status: 503 });
  }

  if (!validateInternalWorkerSecret(request, secret)) {
    console.warn('[SPARTA SIAGA][Worker] unauthorized request blocked');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  if (now - lastWorkerRunTime < WORKER_COOLDOWN_MS) {
    console.warn('[SPARTA SIAGA][Worker] request rate-limited');
    return NextResponse.json({ success: false, error: 'Rate limited' }, { status: 429, headers: { 'Retry-After': '30' } });
  }

  if (isWorkerRunning) {
    console.warn('[SPARTA SIAGA][Worker] already running');
    return NextResponse.json({ success: false, error: 'Worker already running' }, { status: 409 });
  }

  isWorkerRunning = true;
  console.log('[SPARTA SIAGA][Worker] manual worker started');

  try {
    let forceSimulation = false;
    let allowBackfill = false;
    try {
      const body = await request.json();
      forceSimulation = !!body.forceSimulation;
      allowBackfill = !!body.allowBackfill;
    } catch {
      // no body or non-json
    }

    if (process.env.NODE_ENV === 'production' && forceSimulation) {
      console.warn('[SPARTA SIAGA][Worker] Rejected forceSimulation request in production environment');
      return NextResponse.json({
        success: false,
        error: 'Forbidden: Synthetic alert generation and forceSimulation are strictly denied in production.'
      }, { status: 403 });
    }

    // 1. Fetch stores from DB or Master CSV (21,550 stores)
    const stores: Store[] = await getOrLoadMasterStores();

    if (stores.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No stores available in database'
      }, { status: 500 });
    }

    // 2. Fetch active earthquake data from BMKG / USGS
    const disasterFeed = await fetchDisasterFeed();
    const isEligibleForAlert = forceSimulation || (disasterFeed.dataFreshness !== 'stale' && disasterFeed.dataFreshness !== 'unavailable');

    let eqResults = { dispatchedAlerts: 0, createdReports: 0 };
    const activeEarthquakes = disasterFeed.activeEarthquakes || [];

    if (isEligibleForAlert && activeEarthquakes.length > 0) {
      eqResults = await processEarthquakeAlertsAndReports(
        activeEarthquakes,
        stores,
        isEligibleForAlert,
        allowBackfill
      );
    }

    const dispatchedLogs: NotificationLog[] = [];

    // 3. Evaluate Heavy Rain / Flood Potential Simulation if forced simulation requested
    if (forceSimulation && eqResults.dispatchedAlerts === 0) {
      const sampleBranch = stores[0]?.cabang || 'SIDOARJO';
      const sampleStores = stores.filter(s => s.cabang === sampleBranch).slice(0, 5).map(s => ({
        kode_toko: s.kode_toko,
        nama_toko: s.nama_toko,
        cabang: s.cabang,
        distance_km: 1.2,
        status: 'MONITOR' as const,
        alamat: s.alamat,
        fr_type: s.fr_type,
      }));

      const floodLog = await recordNotificationLog({
        disasterId: `flood_sim_${Date.now()}`,
        disasterType: 'heavy_rain',
        channel: 'pwa_only',
        branch: sampleBranch,
        recipientContact: `pwa://dc-${sampleBranch.toLowerCase()}`,
        title: `[SIMULATION] 🌧️ SIAGA HUJAN EKSTREM & BANJIR: Cabang ${sampleBranch}`,
        message: `Model cuaca menunjukkan indikasi presipitasi hujan ekstrem (intensitas > 25 mm/jam) di atas gerai cabang ${sampleBranch}. Segera aktifkan SOP peninggian barang dagang dan pasang tanggul banjir gerai.`,
        affectedStores: sampleStores,
      });
      dispatchedLogs.push(floodLog);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      dispatched_count: eqResults.dispatchedAlerts + dispatchedLogs.length,
      created_reports_count: eqResults.createdReports,
      notifications: dispatchedLogs,
      evaluated_disasters: activeEarthquakes.length,
      message: (eqResults.dispatchedAlerts > 0 || eqResults.createdReports > 0 || dispatchedLogs.length > 0)
        ? `Worker berhasil memproses: ${eqResults.dispatchedAlerts} alert dikirim, ${eqResults.createdReports} laporan operasional dibuat.`
        : 'Worker selesai dijalankan. Seluruh cabang dalam status terpantau normal atau notifikasi sudah dikirim sebelumnya (deduplikasi aktif).'
    });

  } catch (error: any) {
    console.error('[Notification Worker Error]:', error);
    return NextResponse.json({
      success: false,
      error: 'Worker execution failed'
    }, { status: 500 });
  } finally {
    lastWorkerRunTime = Date.now();
    isWorkerRunning = false;
  }
}

export async function GET(request: Request) {
  try {
    // Access control: strictly require internal worker secret or ADMIN session
    const secret = process.env.SPARTA_INTERNAL_WORKER_SECRET;
    const isInternal = secret ? validateInternalWorkerSecret(request, secret) : false;

    if (!isInternal) {
      const sessionUser = await getSessionUser(request);
      if (!sessionUser || sessionUser.systemRole !== 'ADMIN') {
        return NextResponse.json(
          { error: 'Unauthorized: Access restricted to administrators or internal worker daemon.' },
          { status: 401 }
        );
      }
    }

    const pool = getDbPool();

    // 1. Check latest successful BMKG/USGS earthquake polling in persistent store
    const eqPollRes = await pool.query(`
      SELECT 
        MAX(last_seen_at) as last_polled_at,
        count(*)::int as total_active_events
      FROM earthquake_events;
    `);
    const lastPolledAt = eqPollRes.rows[0]?.last_polled_at || null;
    const totalEvents = Number(eqPollRes.rows[0]?.total_active_events || 0);

    // 2. Notification delivery metrics and failure monitoring
    const notifRes = await pool.query(`
      SELECT 
        count(*)::int as total_notifications,
        count(*) FILTER (WHERE delivery_status = 'failed')::int as failed_notifications,
        count(*) FILTER (WHERE delivery_status = 'sent' OR delivery_status = 'delivered')::int as successful_notifications
      FROM notification_logs;
    `);

    // 3. Web Push event delivery metrics
    const pushRes = await pool.query(`
      SELECT 
        count(*)::int as total_push_deliveries,
        count(*) FILTER (WHERE status = 'delivered')::int as delivered_push,
        count(*) FILTER (WHERE status = 'failed')::int as failed_push,
        count(*) FILTER (WHERE status = 'expired_cleaned')::int as expired_cleaned_push
      FROM push_event_deliveries;
    `);

    // 4. In-process daemon health (if running in this process)
    const inProcessDaemon = getDisasterCycleHealth();

    // 5. Evaluate heartbeat freshness
    // If last_polled_at exists and is older than 5 minutes (300,000ms), flag potential stall
    let heartbeatStatus: 'HEALTHY' | 'STALE' | 'INITIALIZING' = 'INITIALIZING';
    let minutesSinceLastPoll: number | null = null;
    if (lastPolledAt) {
      minutesSinceLastPoll = Math.round((Date.now() - new Date(lastPolledAt).getTime()) / (1000 * 60) * 10) / 10;
      heartbeatStatus = minutesSinceLastPoll <= 5 ? 'HEALTHY' : 'STALE';
    }

    return NextResponse.json({
      status: heartbeatStatus === 'HEALTHY' ? 'healthy' : 'degraded',
      heartbeat: {
        status: heartbeatStatus,
        lastSuccessfulPolling: lastPolledAt,
        minutesSinceLastPoll,
        activeEventsTracked: totalEvents,
      },
      notifications: {
        total: Number(notifRes.rows[0]?.total_notifications || 0),
        successful: Number(notifRes.rows[0]?.successful_notifications || 0),
        failed: Number(notifRes.rows[0]?.failed_notifications || 0),
      },
      webPush: {
        totalDeliveries: Number(pushRes.rows[0]?.total_push_deliveries || 0),
        delivered: Number(pushRes.rows[0]?.delivered_push || 0),
        failed: Number(pushRes.rows[0]?.failed_push || 0),
        expiredCleaned: Number(pushRes.rows[0]?.expired_cleaned_push || 0),
      },
      inProcessDaemon,
      timestamp: new Date().toISOString(),
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('[Worker Health GET Error]:', err);
    return NextResponse.json({
      status: 'error',
      error: 'Failed to retrieve worker health status',
      detail: err?.message || String(err),
    }, { status: 500 });
  }
}

