import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { fetchDisasterFeed } from '@/lib/disaster-service';
import { Store } from '@/types/store';
import { NotificationLog } from '@/types/notification';
import { recordNotificationLog } from '@/lib/notification-service';
import { processEarthquakeAlertsAndReports } from '@/lib/server-daemon';
import { getOrLoadMasterStores } from '@/lib/store-master-loader';

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
