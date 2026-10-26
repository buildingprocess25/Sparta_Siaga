import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { dbCreateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";

export async function setupSimulation2(): Promise<void> {
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  console.log("==============================================================");
  console.log("🏭 SETTING UP INITIAL DATA FOR SIMULASI 2 (DC & GEMPA - ATASAN KEDUA)");
  console.log("==============================================================");

  const dcReportId = "INC-UAT2-DC-001";
  const eqReportId = "INC-UAT2-EQ-001";
  const eqEventId = "EQ-UAT-BDG-2026";

  // Clean previous run of this specific simulation reports if any
  for (const repId of [dcReportId, eqReportId]) {
    await pool.query("DELETE FROM report_completion_approval_history WHERE report_id = $1", [repId]);
    await pool.query("DELETE FROM report_completion_approvals WHERE report_id = $1", [repId]);
    await pool.query("DELETE FROM report_milestones WHERE report_id = $1", [repId]);
    await pool.query("DELETE FROM report_estimation_routes WHERE report_id = $1", [repId]);
    await pool.query("DELETE FROM report_distributions WHERE report_id = $1", [repId]);
    await pool.query("DELETE FROM incident_pic_history WHERE incident_id = $1", [repId]);
    await pool.query("DELETE FROM incidents WHERE id = $1", [repId]);
  }

  // Also clean previous notification logs for UAT
  await pool.query("DELETE FROM notification_logs WHERE disaster_id = ANY($1)", [[dcReportId, eqReportId]]);

  const nowIso = new Date().toISOString();

  // 1. Initial Incident: DC Facility Incident (BES -> BEC -> BnM)
  const dcIncident: IncidentRecord = {
    id: dcReportId,
    date: nowIso,
    disasterType: "heavy_rain",
    reportOrigin: "manual",
    tkpType: "dc",
    locationKind: "FACILITY",
    locationId: "b92e1ec9-a96b-4774-9f7f-94805e327a9b",
    storeId: "FACILITY:BZ01",
    storeName: "DC BANDUNG",
    branch: "BANDUNG",
    locationCity: "KOTA BANDUNG",
    status: "verifying",
    progress: 10,
    reporter: {
      name: "Demo BES Bandung",
      role: "bes",
      branch: "BANDUNG",
    },
    fieldPhotos: ["/simulasi-uat/11_foto_kejadian_awal_dc.jpg"],
    timeline: [
      {
        stage: "Dilaporkan",
        label: "Laporan Kerusakan Fasilitas DC",
        timestamp: nowIso,
        actor: "Demo BES Bandung",
        notes: "[UAT-ATASAN-2] Rel rolling door loading dock Bay 4 macet dan bengkok akibat benturan hidrolik forklift saat evakuasi logistik darurat.",
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await dbCreateIncident(dcIncident);
  console.log(`✔ [Simulasi 2 - DC Incident Initialized] ID: ${dcReportId}`);
  console.log(`  Facility   : DC BANDUNG (BZ01) - BANDUNG`);
  console.log(`  Status     : ${dcIncident.status} (Tahap: Pemeriksaan Lapangan oleh BES / Konfirmasi BnM)`);

  // 2. Initial Incident: Automated Earthquake Monitoring Incident (Simulation)
  const eqIncident: IncidentRecord = {
    id: eqReportId,
    date: nowIso,
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    earthquakeEventId: eqEventId,
    earthquakeSource: "BMKG_SIMULATION_UAT",
    earthquakeProvenance: "SIMULATED_TEST_BROADCAST",
    tkpType: "toko",
    storeId: "SAT-B017",
    storeName: "BABAKAN SARI",
    branch: "BANDUNG",
    locationCity: "KOTA BANDUNG",
    status: "pending_confirmation", // Belum Diperiksa
    progress: 0,
    reporter: {
      name: "Sistem Sparta Siaga Auto-Alert",
      role: "sparta_maintenance",
      branch: "ALL",
    },
    disasterMetadata: {
      magnitude: 5.2,
      depth: "10 km",
      place: "Kabupaten Bandung dan sekitarnya",
      distanceKm: 35,
    },
    fieldPhotos: [],
    timeline: [
      {
        stage: "Peringatan Gempa Otomatis",
        label: "Deteksi Gempa M 5.2",
        timestamp: nowIso,
        actor: "Auto-Alert System",
        notes: "[UAT-ATASAN-2] Deteksi Gempa Otomatis: M 5.2, Kedalaman 10 km, Radius Pantauan 35 km dari Toko.",
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await dbCreateIncident(eqIncident);
  console.log(`✔ [Simulasi 2 - Auto Earthquake Initialized] ID: ${eqReportId}`);
  console.log(`  Store      : BABAKAN SARI (SAT-B017) - BANDUNG`);
  console.log(`  Status     : ${eqIncident.status} (Belum Diperiksa - Menunggu Pemeriksaan Lapangan BMS)`);

  // 3. Insert notification log for cross-branch demo
  await pool.query(
    `INSERT INTO notification_logs (
      id, disaster_id, ticket_number, disaster_type, channel, branch, recipient_role, recipient_contact, title, message, status, sent_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
    [
      `notif_uat2_${Date.now()}`,
      eqReportId,
      eqReportId,
      "earthquake",
      "pwa_only",
      "BANDUNG",
      "Duty Officer DC & Cabang",
      "in-app://all/bandung",
      "[UAT-ATASAN-2] Peringatan Gempa Otomatis M 5.2 Wilayah Jawa Barat",
      "Deteksi gempa M5.2 kedalaman 10 km. Toko BABAKAN SARI (SAT-B017) berada dalam zona pemantauan 35 km.",
      "sent",
    ]
  );
  console.log(`✔ [Simulasi 2 - Notification Broadcast Initialized]`);
  console.log("==============================================================");
}

if (process.argv[1]?.endsWith("setup-simulation-2.ts")) {
  setupSimulation2()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Error setting up simulation 2:", err);
      await closeDbPool();
      process.exit(1);
    });
}
