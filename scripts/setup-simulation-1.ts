import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { dbCreateIncident } from "../lib/incident-db";
import { IncidentRecord } from "../types/incident";

export async function setupSimulation1(): Promise<void> {
  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  console.log("==============================================================");
  console.log("🏪 SETTING UP INITIAL DATA FOR SIMULASI 1 (TOKO - ATASAN PERTAMA)");
  console.log("==============================================================");

  const reportId = "INC-UAT1-TOKO-001";

  // Clean previous run of this specific simulation report if any
  await pool.query("DELETE FROM report_completion_approval_history WHERE report_id = $1", [reportId]);
  await pool.query("DELETE FROM report_completion_approvals WHERE report_id = $1", [reportId]);
  await pool.query("DELETE FROM report_milestones WHERE report_id = $1", [reportId]);
  await pool.query("DELETE FROM report_estimation_routes WHERE report_id = $1", [reportId]);
  await pool.query("DELETE FROM report_distributions WHERE report_id = $1", [reportId]);
  await pool.query("DELETE FROM incident_pic_history WHERE incident_id = $1", [reportId]);
  await pool.query("DELETE FROM incidents WHERE id = $1", [reportId]);

  const nowIso = new Date().toISOString();

  // Create clean initial incident for Simulasi 1
  const initialIncident: IncidentRecord = {
    id: reportId,
    date: nowIso,
    disasterType: "flood",
    reportOrigin: "manual",
    reporter: {
      name: "Demo BMS Bandung",
      role: "bms",
      branch: "BANDUNG",
    },
    tkpType: "toko",
    storeId: "SAT-B081",
    storeName: "CICAHEUM",
    branch: "BANDUNG",
    locationCity: "KOTA BANDUNG",
    status: "verifying",
    progress: 10,
    fieldPhotos: ["/simulasi-uat/01_foto_kejadian_awal_toko.jpg"],
    timeline: [
      {
        stage: "Dilaporkan",
        label: "Laporan Kerusakan Toko",
        timestamp: nowIso,
        actor: "Demo BMS Bandung",
        notes: "[UAT-ATASAN-1] Plafon gypsum ambrol dan atap bocor akibat curah hujan deras di area kasir.",
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await dbCreateIncident(initialIncident);

  console.log(`✔ [Simulasi 1 Initialized] Incident ID: ${reportId}`);
  console.log(`  Store      : ${initialIncident.storeName} (${initialIncident.storeId}) - ${initialIncident.branch}`);
  console.log(`  Status     : ${initialIncident.status} (Tahap: Pemeriksaan Lapangan oleh BMS / Konfirmasi BnM)`);
  console.log(`  Penanda    : [UAT-ATASAN-1]`);
  console.log("==============================================================");
}

if (process.argv[1]?.endsWith("setup-simulation-1.ts")) {
  setupSimulation1()
    .then(async () => {
      await closeDbPool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Error setting up simulation 1:", err);
      await closeDbPool();
      process.exit(1);
    });
}
