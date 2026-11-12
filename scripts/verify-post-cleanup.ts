import { getDbPool, closeDbPool } from "../lib/db";
import { dbGetAllIncidents, dbGetIncidentById } from "../lib/incident-db";
import { canViewReport, canInspectReport, canApproveAsBm, canActOnReport } from "../lib/report-permissions";
import { RETAINED_DEMO_REPORTS } from "./cleanup-demo-reports";

async function verifyAll() {
  console.log("================================================================================");
  console.log("  SPARTA SIAGA - VERIFIKASI POST-CLEANUP LENGKAP");
  console.log("================================================================================");

  const pool = getDbPool();

  // 1. Total Laporan = Tepat 5
  console.log("\n[TEST 1] Verifikasi jumlah laporan di database...");
  const countRes = await pool.query("SELECT COUNT(*) as count FROM incidents");
  const count = Number(countRes.rows[0].count);
  console.log(`  Count in DB: ${count}`);
  if (count !== 5) {
    throw new Error(`FAIL: Count is ${count}, expected 5`);
  }
  console.log("  ✓ PASS: Total laporan tepat 5.");

  // 2. Verifikasi 5 ID laporan tepat sesuai target
  console.log("\n[TEST 2] Verifikasi 5 ID laporan dan statusnya...");
  const incidents = await dbGetAllIncidents();
  console.table(incidents.map((inc, i) => ({
    No: i + 1,
    ID: inc.id,
    Lokasi: inc.storeName,
    Cabang: inc.branch,
    Status: inc.status,
    Progress: `${inc.progress}%`,
    PIC: inc.primaryPicName || inc.primaryPicUserId || "-",
    Target: inc.maintenanceTicket?.completedAt ? new Date(inc.maintenanceTicket.completedAt).toLocaleDateString("id-ID") : "-"
  })));

  const existingIds = incidents.map(i => i.id).sort();
  const expectedIds = RETAINED_DEMO_REPORTS.map(r => r.id).sort();
  if (JSON.stringify(existingIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`FAIL: IDs in DB do not match expected 5 demo IDs`);
  }
  console.log("  ✓ PASS: 5 ID laporan tepat sesuai target.");

  // 3. Verifikasi Foreign Keys & Tidak Ada Orphan Records
  console.log("\n[TEST 3] Verifikasi integritas relasi foreign keys...");
  const orphanChecks = [
    { table: "report_milestones", col: "report_id" },
    { table: "report_completion_approvals", col: "report_id" },
    { table: "report_completion_approval_history", col: "report_id" },
    { table: "report_distributions", col: "report_id" },
    { table: "integration_sync_logs", col: "incident_id" },
    { table: "incident_pic_history", col: "incident_id" },
    { table: "estimations", col: "report_id" },
    { table: "report_progress_updates", col: "report_id" },
    { table: "report_progress_photos", col: "report_id" },
    { table: "report_instructions", col: "report_id" }
  ];

  for (const oc of orphanChecks) {
    const extraFilter = oc.table === "integration_sync_logs" ? "AND t.incident_id != 'ALL'" : "";
    const res = await pool.query(
      `SELECT COUNT(*) as count FROM ${oc.table} t 
       WHERE t.${oc.col} NOT IN (SELECT id FROM incidents) ${extraFilter}`
    );
    const orphanCount = Number(res.rows[0].count);
    if (orphanCount > 0) {
      throw new Error(`FAIL: Found ${orphanCount} orphan records in ${oc.table}`);
    }
  }
  console.log("  ✓ PASS: Nol (0) orphan records ditemukan pada seluruh tabel relasi.");

  // 4. Verifikasi Role Visibility & Hak Akses
  console.log("\n[TEST 4] Verifikasi hak akses BMS, BES, Manager Branch, dan HO...");

  const bmsBandung = {
    id: "USR-BMS-001",
    name: "Demo BMS Bandung",
    role: "bms" as const,
    systemRole: "USER" as const,
    scope: "BRANCH" as const,
    branch: "BANDUNG"
  };

  const besBandung = {
    id: "USR-DEMO-BES",
    name: "Demo BES Bandung",
    role: "bes" as const,
    systemRole: "USER" as const,
    scope: "BRANCH" as const,
    branch: "BANDUNG"
  };

  const bmBandung = {
    id: "USR-BM-G001",
    name: "Demo Manager BMM Bandung",
    role: "bm" as const,
    systemRole: "USER" as const,
    scope: "BRANCH" as const,
    branch: "BANDUNG"
  };

  const bmCikokol = {
    id: "u-test-bm",
    name: "Manager Branch Cikokol",
    role: "bm" as const,
    systemRole: "USER" as const,
    scope: "BRANCH" as const,
    branch: "CIKOKOL"
  };

  const hoAdmin = {
    id: "USR-HO-BUDI",
    name: "Demo HO Monitoring",
    role: "ho_admin" as const,
    systemRole: "USER" as const,
    scope: "HO" as const,
    branch: null
  };

  // BMS Visibility
  const bmsVisible = incidents.filter(i => canViewReport(bmsBandung, i));
  console.log(`  • BMS Bandung melihat: ${bmsVisible.length} laporan (semua cabang Bandung).`);
  for (const inc of incidents) {
    const canInspect = canInspectReport(bmsBandung, inc);
    const isDc = inc.tkpType === "dc" || inc.locationKind === "FACILITY";
    if (isDc && canInspect) {
      throw new Error(`FAIL: BMS should not be able to inspect DC facility ${inc.id}`);
    }
    if (!isDc && !canInspect) {
      throw new Error(`FAIL: BMS should be able to inspect store ${inc.id}`);
    }
  }
  console.log("  ✓ PASS: Kewenangan BMS terisolasi tepat (hanya memeriksa Toko, tidak memeriksa DC).");

  // BES Visibility & Authority
  for (const inc of incidents) {
    const canInspect = canInspectReport(besBandung, inc);
    const isDc = inc.tkpType === "dc" || inc.locationKind === "FACILITY";
    if (isDc && !canInspect) {
      throw new Error(`FAIL: BES should be able to inspect DC facility ${inc.id}`);
    }
    if (!isDc && canInspect) {
      throw new Error(`FAIL: BES should not be able to inspect store ${inc.id}`);
    }
  }
  console.log("  ✓ PASS: Kewenangan BES terisolasi tepat (hanya memeriksa DC, tidak memeriksa Toko).");

  // Branch Manager Bandung
  const bmVisible = incidents.filter(i => canViewReport(bmBandung, i));
  console.log(`  • BM Bandung melihat: ${bmVisible.length} laporan (semua laporan cabangnya).`);
  if (bmVisible.length !== 5) {
    throw new Error(`FAIL: BM Bandung should see all 5 Bandung reports`);
  }
  const unapproved = incidents.find(i => i.id === "INC-SPRINT-TOKO-1791971633374-UNAPPROVED");
  if (!unapproved || !canApproveAsBm(bmBandung, unapproved)) {
    throw new Error(`FAIL: BM Bandung must be able to approve unapproved report`);
  }
  console.log("  ✓ PASS: BM Bandung berwenang mengonfirmasi/menyetujui laporan pending_bm_approval.");

  // Branch Manager Cikokol (Branch Isolation)
  const bmCikokolVisible = incidents.filter(i => canViewReport(bmCikokol, i));
  console.log(`  • BM Cikokol melihat: ${bmCikokolVisible.length} laporan (cabang lain terisolasi total).`);
  if (bmCikokolVisible.length !== 0) {
    throw new Error(`FAIL: BM Cikokol must see 0 reports from Bandung`);
  }
  console.log("  ✓ PASS: Isolasi cabang terverifikasi (Manager Branch hanya melihat laporan cabangnya sendiri).");

  // HO Monitoring (Global Read-Only)
  const hoVisible = incidents.filter(i => canViewReport(hoAdmin, i));
  console.log(`  • HO Monitoring melihat: ${hoVisible.length} laporan (seluruh cabang).`);
  if (hoVisible.length !== 5) {
    throw new Error(`FAIL: HO Admin must see all 5 reports`);
  }
  for (const inc of incidents) {
    if (canActOnReport(hoAdmin, inc)) {
      throw new Error(`FAIL: HO Admin must be strictly read-only on reports`);
    }
  }
  console.log("  ✓ PASS: HO dapat melihat seluruh laporan secara read-only (tidak dapat mutasi).");

  // 5. Verifikasi Notifikasi BMS Tersedia di Database
  console.log("\n[TEST 5] Verifikasi notifikasi BMS di notification_logs...");
  const notifRes = await pool.query(
    `SELECT id, ticket_number, branch, recipient_contact, title FROM notification_logs WHERE branch = 'BANDUNG'`
  );
  console.log(`  • Notifikasi aktif untuk BMS Bandung: ${notifRes.rows.length} record.`);
  for (const n of notifRes.rows) {
    console.log(`    - [${n.ticket_number}] ${n.title} -> ${n.recipient_contact}`);
  }
  if (notifRes.rows.length === 0) {
    throw new Error("FAIL: No notification found for BMS Bandung");
  }
  console.log("  ✓ PASS: Notifikasi BMS tercatat di database dan siap dipicu via terminal.");

  // 6. Verifikasi Statistik Dashboard
  console.log("\n[TEST 6] Verifikasi kalkulasi dashboard & statistik...");
  const activeCount = incidents.filter(i => i.status !== "closed" && i.status !== "resolved").length;
  const closedCount = incidents.filter(i => i.status === "closed" || i.status === "resolved").length;
  console.log(`  • Laporan Aktif  : ${activeCount}`);
  console.log(`  • Laporan Selesai: ${closedCount}`);
  console.log(`  • Total Laporan  : ${incidents.length}`);

  if (activeCount !== 4 || closedCount !== 1) {
    throw new Error(`FAIL: Expected 4 active and 1 closed, got ${activeCount} active and ${closedCount} closed`);
  }
  console.log("  ✓ PASS: Statistik dashboard konsisten dan akurat.");

  console.log("\n================================================================================");
  console.log("  SELURUH VERIFIKASI POST-CLEANUP LULUS DENGAN SUKSES! (100% PASS)");
  console.log("================================================================================\n");

  await closeDbPool();
}

verifyAll().catch(async (err) => {
  console.error("\n[VERIFICATION ERROR]:", err);
  await closeDbPool();
  process.exit(1);
});
