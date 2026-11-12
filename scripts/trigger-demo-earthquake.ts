/**
 * SPARTA SIAGA - Satu laporan gempa SIMULASI Bandung + notifikasi pemeriksaan BMS.
 * Command: pnpm tsx scripts/trigger-demo-earthquake.ts
 *
 * HANYA menulis ke sparta_siaga_isolated (staging). Tidak mengubah master
 * stores/facilities, tidak menggunakan gempa BMKG/USGS dan tidak mengirim WA/email.
 * Idempotent: trigger berulang tetap satu laporan + satu notifikasi.
 */
import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { ensureEarthquakeReport } from "../lib/earthquake-report-service";
import { dbCreateIncident } from "../lib/incident-db";
import { recordNotificationLog } from "../lib/notification-service";

const REPORT_ID = "LAP-EQ-DEMO-BDG-001";
const EVENT_ID = "SIMULASI-EQ-BANDUNG-DEMO-001";
const SOURCE = "SIMULASI INTERNAL - BUKAN BMKG/USGS";

type DemoStore = {
  kode_toko: string;
  nama_toko: string;
  cabang: string;
  fr_type: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Tidak boleh menjalankan simulasi pada NODE_ENV=production.");
  }
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  const current = await pool.query<{
    id: string;
    earthquake_event_id: string | null;
    branch: string;
  }>(
    "SELECT id, earthquake_event_id, branch FROM incidents WHERE id = $1",
    [REPORT_ID]
  );
  if (current.rows[0]) {
    if (current.rows[0].earthquake_event_id !== EVENT_ID ||
        current.rows[0].branch !== "BANDUNG") {
      throw new Error("ID laporan simulasi telah digunakan data lain; dibatalkan.");
    }
  } else {
    const count = await pool.query<{ total: number }>(
      "SELECT COUNT(*)::int AS total FROM incidents"
    );
    if (count.rows[0]?.total !== 0) {
      throw new Error("Ada laporan lain dalam database. Tidak menghapus/menimpa; gunakan staging yang sudah direset.");
    }
  }

  // Data master toko riil lebih diutamakan. Koordinat tidak wajib untuk
  // workflow inspeksi BMS -> bukti foto -> konfirmasi BnM Manajer.
  const selected = await pool.query<DemoStore>(
    "SELECT kode_toko, nama_toko, cabang, fr_type, latitude, longitude FROM stores " +
    "WHERE UPPER(TRIM(cabang)) = 'BANDUNG' " +
    "AND kode_toko IS NOT NULL AND kode_toko <> '' " +
    "AND nama_toko IS NOT NULL AND nama_toko <> '' " +
    "ORDER BY CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 0 ELSE 1 END, " +
    "CASE WHEN nama_toko ILIKE '%DAGO%' THEN 0 ELSE 1 END, kode_toko LIMIT 1"
  );

  const store: DemoStore = selected.rows[0] ?? {
    kode_toko: "T-DEMO-BDG-001",
    nama_toko: "Toko Simulasi Bandung",
    cabang: "BANDUNG",
    fr_type: "SIMULASI",
    latitude: null,
    longitude: null,
  };
  const isVirtualStore = !selected.rows[0];
  const lat = store.latitude == null ? NaN : Number(store.latitude);
  const lon = store.longitude == null ? NaN : Number(store.longitude);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const simulationNote =
    "SIMULASI RAPAT (bukan informasi gempa nyata). " +
    "Penentuan toko/zona bukan hasil pengukuran BMKG/USGS.";

  if (!current.rows[0]) {
    if (hasCoordinates) {
      const created = await ensureEarthquakeReport({
        reportId: REPORT_ID,
        canonicalEventId: EVENT_ID,
        eventOccurredAt: new Date(),
        source: SOURCE,
        location: {
          kind: "STORE",
          id: store.kode_toko,
          code: store.kode_toko,
          name: store.nama_toko,
          type: store.fr_type || "TOKO",
          branch: "BANDUNG",
          latitude: lat,
          longitude: lon,
        },
      });
      // Narrow the result union before reading incidentId: the "ambiguous"
      // outcome has candidateIncidentIds instead of an incidentId.
      if (created.outcome !== "created" && created.outcome !== "existing") {
        throw new Error("Laporan simulasi tidak dapat dibuat: " + created.outcome);
      }
      if (created.incidentId !== REPORT_ID) {
        throw new Error("Laporan simulasi tidak terbuat dengan ID yang direncanakan.");
      }
    } else {
      // Fallback tanpa koordinat: buat laporan inspeksi, bukan klaim zona
      // geografis aktual. Tidak menyisipkan toko dummy ke tabel stores.
      const now = new Date().toISOString();
      await dbCreateIncident({
        id: REPORT_ID,
        date: now,
        disasterType: "earthquake",
        reportOrigin: "automatic_earthquake",
        earthquakeEventId: EVENT_ID,
        earthquakeSource: SOURCE,
        earthquakeProvenance: simulationNote,
        tkpType: "toko",
        storeId: store.kode_toko,
        storeName: store.nama_toko,
        branch: "BANDUNG",
        locationCity: "Bandung",
        locationKind: "STORE",
        locationId: store.kode_toko,
        status: "pending_confirmation",
        progress: 0,
        fieldPhotos: [],
        timeline: [{
          stage: "Laporan Simulasi Dibuat",
          label: "Simulasi gempa untuk pemeriksaan toko oleh BMS",
          timestamp: now,
          actor: "SPARTA SIAGA - DEMO",
          notes: simulationNote,
        }],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const exists = await pool.query<{ id: string }>(
    "SELECT id FROM notification_logs WHERE ticket_number = $1 " +
    "AND branch = 'BANDUNG' AND recipient_group = 'BMS' " +
    "AND notification_category = 'ASSIGNMENT' LIMIT 1",
    [REPORT_ID]
  );

  let notificationId = exists.rows[0]?.id;
  if (!notificationId) {
    const created = await recordNotificationLog({
      disasterId: REPORT_ID,
      canonicalEventId: EVENT_ID,
      disasterType: "earthquake",
      channel: "pwa_only",
      branch: "BANDUNG",
      recipientContact: "in-app://bms/bandung",
      recipientGroup: "BMS",
      category: "ASSIGNMENT",
      ticketNumber: REPORT_ID,
      title: "[SIMULASI] [TUGAS PEMERIKSAAN] " + store.nama_toko,
      message: simulationNote + " BMS Bandung perlu memeriksa toko " + store.nama_toko +
        ", mengunggah foto bukti, lalu mengirim hasil pemeriksaan ke BnM Manajer. " +
        "Maintenance baru dilanjutkan jika dikonfirmasi ada kerusakan.",
      // Nilai jarak 0 merupakan placeholder format notifikasi DEMO, bukan
      // perhitungan jarak gempa sebenarnya (lihat label SIMULASI pada notifikasi).
      affectedStores: [{
        kode_toko: store.kode_toko,
        nama_toko: store.nama_toko,
        cabang: "BANDUNG",
        distance_km: 0,
        status: "PRIORITY_MONITOR",
        fr_type: store.fr_type || undefined,
      }],
    });
    notificationId = created.id;
  }
  const verify = await pool.query<{ status: string }>(
    "SELECT status FROM incidents WHERE id = $1",
    [REPORT_ID]
  );
  console.log("TRIGGER SIMULASI BERHASIL");
  console.log("Laporan        : " + REPORT_ID);
  console.log("Toko           : " + store.nama_toko +
    (isVirtualStore ? " (VIRTUAL - BUKAN MASTER TOKO)" : " (MASTER TOKO)"));
  console.log("Cabang         : BANDUNG");
  console.log("Status         : " + (verify.rows[0]?.status || "UNKNOWN"));
  console.log("Notifikasi BMS : " + notificationId);
  if (!hasCoordinates) {
    console.log("Peta/jarak     : Tidak tervalidasi (demo tanpa koordinat toko)");
  }
  console.log("Selanjutnya    : Login BMS BMS0001, buka lonceng, inspeksi + foto.");
}

main()
  .catch((error: unknown) => {
    console.error("[GAGAL] " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  })
  .finally(async () => { await closeDbPool(); });
