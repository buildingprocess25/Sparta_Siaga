/**
 * SPARTA SIAGA - Database Cleanup Script untuk Demo Rapat
 * 
 * Membersihkan seluruh data laporan pengujian lama dan hanya mempertahankan
 * tepat 5 laporan demonstrasi pada database development/staging.
 * 
 * Penggunaan:
 *   pnpm tsx scripts/cleanup-demo-reports.ts --dry-run
 *   pnpm tsx scripts/cleanup-demo-reports.ts --apply --confirm-demo-cleanup
 */

import fs from "node:fs";
import path from "node:path";
import { getDbPool, closeDbPool } from "../lib/db.js";
import { runDevelopmentBackup } from "./backup-dev.js";

// ============================================================================
// KONFIGURASI 5 LAPORAN DEMO
// ============================================================================

export interface DemoReportTarget {
  id: string;
  categoryNumber: number;
  categoryTitle: string;
  name: string;
  branch: string;
  locationKind: "STORE" | "FACILITY";
  tkpType: "toko" | "dc";
  storeId: string;
  status: string;
  progress: number;
  primaryPicUserId: string | null;
  primaryPicName: string | null;
  targetCompletion: string | null;
  notes: string;
}

export const RETAINED_DEMO_REPORTS: DemoReportTarget[] = [
  {
    id: "INC-HTTP-BDG-1791869681432",
    categoryNumber: 1,
    categoryTitle: "Laporan yang siap ditangani BMS",
    name: "Alfamart Dago Plaza",
    branch: "BANDUNG",
    locationKind: "STORE",
    tkpType: "toko",
    storeId: "T-BDG-001",
    status: "confirmed_affected",
    progress: 0,
    primaryPicUserId: null,
    primaryPicName: null,
    targetCompletion: null,
    notes: "Kerusakan telah disetujui BM. Siap diambil tugas oleh BMS (Mulai Menangani) dan menerima trigger notifikasi.",
  },
  {
    id: "INC-API-TOKO-1791864995272",
    categoryNumber: 2,
    categoryTitle: "Laporan berstatus On Progress dengan PIC dan target",
    name: "Alfamart Dago Asri 777",
    branch: "BANDUNG",
    locationKind: "STORE",
    tkpType: "toko",
    storeId: "T-BDG-777",
    status: "in_maintenance",
    progress: 50,
    primaryPicUserId: "USR-BMS-001",
    primaryPicName: "Demo BMS Bandung",
    targetCompletion: "2026-10-25T17:00:00.000Z",
    notes: "SPK diterbitkan, sedang dalam perbaikan fisik oleh PIC BMS Bandung dengan target selesai 25 Oktober 2026.",
  },
  {
    id: "INC-SPRINT-TOKO-1791971633374-UNAPPROVED",
    categoryNumber: 3,
    categoryTitle: "Laporan yang memerlukan konfirmasi Manager Branch",
    name: "Alfamart Dago Bandung",
    branch: "BANDUNG",
    locationKind: "STORE",
    tkpType: "toko",
    storeId: "T-BDG-001",
    status: "pending_bm_approval",
    progress: 0,
    primaryPicUserId: null,
    primaryPicName: null,
    targetCompletion: null,
    notes: "Pemeriksaan selesai diajukan. Menunggu persetujuan Branch Manager tanpa melewati alur bisnis sah.",
  },
  {
    id: "INC-SPRINT-DC-1791971633374",
    categoryNumber: 4,
    categoryTitle: "Laporan fasilitas/DC untuk BES",
    name: "Distribution Center Soekarno Hatta",
    branch: "BANDUNG",
    locationKind: "FACILITY",
    tkpType: "dc",
    storeId: "DC-BDG-01",
    status: "in_maintenance",
    progress: 10,
    primaryPicUserId: null,
    primaryPicName: null,
    targetCompletion: null,
    notes: "Fasilitas DC Cimahi/Soekarno Hatta. Milestone ceklis diajukan BES (Dedi Engineering).",
  },
  {
    id: "INC-SPRINT-TOKO-1791971633374",
    categoryNumber: 5,
    categoryTitle: "Laporan yang sudah selesai",
    name: "Alfamart Setiabudi 99",
    branch: "BANDUNG",
    locationKind: "STORE",
    tkpType: "toko",
    storeId: "T-BDG-099",
    status: "closed",
    progress: 100,
    primaryPicUserId: null,
    primaryPicName: null,
    targetCompletion: null,
    notes: "Pekerjaan selesai 100%, persetujuan penutupan resmi disahkan Branch Manager pada 14 Oktober 2026.",
  },
];

const RETAINED_IDS = RETAINED_DEMO_REPORTS.map((r) => r.id);

// ============================================================================
// ENVIRONMENT & SAFETY GUARDS
// ============================================================================

async function verifyEnvironmentSafety(pool: ReturnType<typeof getDbPool>): Promise<{ dbName: string }> {
  // 1. Guard against NODE_ENV === 'production'
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[DITOLAK] Script cleanup demo DITOLAK: NODE_ENV terdeteksi 'production'. Hanya diizinkan pada development/staging."
    );
  }

  // 2. Query active database name from Postgres directly
  const dbRes = await pool.query("SELECT current_database() as db_name, current_user as db_user");
  const dbName: string = dbRes.rows[0]?.db_name || "";

  // 3. Reject if DB name points to production or is not isolated/test/dev/staging
  const isSafeDevDatabase =
    dbName.includes("isolated") ||
    dbName.includes("dev") ||
    dbName.includes("test") ||
    dbName.includes("staging");

  if (!isSafeDevDatabase || dbName === "sparta_siaga_production" || dbName === "production") {
    throw new Error(
      `[DITOLAK] Database '${dbName}' BUKAN environment pengujian/staging yang sah. Script menolak eksekusi pada database produksi demi integritas data.`
    );
  }

  return { dbName };
}

// ============================================================================
// MAIN CLEANUP LOGIC
// ============================================================================

export async function runDemoCleanup(options: { dryRun: boolean; apply: boolean; confirm: boolean }) {
  console.log("================================================================================");
  console.log("  SPARTA SIAGA - DATABASE CLEANUP UNTUK DEMO RAPAT (5 LAPORAN FINAL)");
  console.log("================================================================================");

  const pool = getDbPool();

  // 1. Audit Koneksi & Verifikasi Lingkungan
  console.log("\n[1/6] Memeriksa koneksi database aktif & memverifikasi environment...");
  const { dbName } = await verifyEnvironmentSafety(pool);
  console.log(`  ✓ Database aktif terverifikasi : ${dbName} (Development / Staging Isolated)`);
  console.log(`  ✓ Protection Guard           : Database production dilindungi secara ketat.`);

  // 2. Audit Jumlah Laporan Saat Ini
  console.log("\n[2/6] Melakukan audit laporan aktif di database...");
  const currentIncidentsRes = await pool.query(`
    SELECT 
      i.id,
      i.branch,
      COALESCE(i.location_name_snapshot, i.store_name) AS store_name,
      i.location_kind,
      i.tkp_type,
      i.status,
      i.progress,
      i.primary_pic_user_id,
      u.name AS primary_pic_name,
      i.maintenance_ticket->>'completedAt' AS target_completion,
      i.created_at
    FROM incidents i
    LEFT JOIN users u ON u.id = i.primary_pic_user_id
    ORDER BY i.created_at DESC
  `);

  const allIncidents = currentIncidentsRes.rows;
  const totalBefore = allIncidents.length;
  console.log(`  ✓ Total laporan sebelum cleanup: ${totalBefore} laporan.`);

  // 3. Validasi 5 Laporan Pilihan
  console.log("\n[3/6] Memvalidasi keberadaan 5 laporan pilihan untuk demonstrasi...");
  const existingMap = new Map(allIncidents.map((r) => [r.id, r]));

  for (const target of RETAINED_DEMO_REPORTS) {
    const found = existingMap.get(target.id);
    if (!found) {
      throw new Error(
        `[GAGAL] Laporan pilihan '${target.id}' (${target.name}) TIDAK DITEMUKAN di database! Operasi dibatalkan.`
      );
    }
    console.log(`  ✓ [Kategori ${target.categoryNumber}] Ditemukan: ${target.id}`);
    console.log(`      Lokasi : ${target.name} (${target.branch}) [${target.locationKind}]`);
    console.log(`      Peran  : ${target.categoryTitle}`);
  }

  const reportsToDelete = allIncidents.filter((inc) => !RETAINED_IDS.includes(inc.id));
  const deleteIds = reportsToDelete.map((r) => r.id);
  const totalToDelete = deleteIds.length;
  const totalAfter = totalBefore - totalToDelete;

  console.log(`\n  Ringkasan Rencana Pembersihan:`);
  console.log(`    • Laporan Dipertahankan : ${RETAINED_IDS.length} laporan`);
  console.log(`    • Laporan Dihapus       : ${totalToDelete} laporan`);
  console.log(`    • Total Laporan Akhir   : ${totalAfter} laporan`);

  // 4. Audit Seluruh Tabel Relasi & Dependent Records
  console.log("\n[4/6] Menghitung dampak relasi data turunan...");

  let dependentCounts = {
    milestones: 0,
    approvals: 0,
    approvalHistory: 0,
    distributions: 0,
    syncLogs: 0,
    notificationLogs: 0,
    picHistory: 0,
    inspectionSubmissions: 0,
    confirmationDecisions: 0,
    evidence: 0,
    matchReviews: 0,
    reconCases: 0,
    reconAudit: 0,
    repairLinkHistory: 0,
    repairLinks: 0,
    estimations: 0,
    estimationRoutes: 0,
    progressPhotos: 0,
    progressUpdates: 0,
    instructions: 0,
  };

  if (deleteIds.length > 0) {
    const countRes = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM report_milestones WHERE report_id = ANY($1::text[])) as ms_cnt,
        (SELECT COUNT(*) FROM report_completion_approvals WHERE report_id = ANY($1::text[])) as app_cnt,
        (SELECT COUNT(*) FROM report_completion_approval_history WHERE report_id = ANY($1::text[])) as aph_cnt,
        (SELECT COUNT(*) FROM report_distributions WHERE report_id = ANY($1::text[])) as dst_cnt,
        (SELECT COUNT(*) FROM integration_sync_logs WHERE incident_id = ANY($1::text[])) as sync_cnt,
        (SELECT COUNT(*) FROM notification_logs WHERE disaster_id = ANY($1::text[]) OR ticket_number = ANY($1::text[])) as ntf_cnt,
        (SELECT COUNT(*) FROM incident_pic_history WHERE incident_id = ANY($1::text[])) as pic_cnt,
        (SELECT COUNT(*) FROM incident_inspection_submissions WHERE report_id = ANY($1::text[])) as insp_cnt,
        (SELECT COUNT(*) FROM incident_confirmation_decisions WHERE report_id = ANY($1::text[])) as dec_cnt,
        (SELECT COUNT(*) FROM incident_evidence WHERE report_id = ANY($1::text[])) as evd_cnt,
        (SELECT COUNT(*) FROM incident_earthquake_match_reviews WHERE candidate_report_id = ANY($1::text[])) as mr_cnt,
        (SELECT COUNT(*) FROM earthquake_reconciliation_cases WHERE incident_id = ANY($1::text[])) as rc_cnt,
        (SELECT COUNT(*) FROM earthquake_reconciliation_audit WHERE incident_id = ANY($1::text[])) as ra_cnt,
        (SELECT COUNT(*) FROM incident_repair_link_history WHERE incident_id = ANY($1::text[])) as rlh_cnt,
        (SELECT COUNT(*) FROM incident_repair_links WHERE incident_id = ANY($1::text[])) as rl_cnt,
        (SELECT COUNT(*) FROM estimations WHERE report_id = ANY($1::text[])) as est_cnt,
        (SELECT COUNT(*) FROM report_estimation_routes WHERE report_id = ANY($1::text[])) as rte_cnt,
        (SELECT COUNT(*) FROM report_progress_photos WHERE report_id = ANY($1::text[])) as php_cnt,
        (SELECT COUNT(*) FROM report_progress_updates WHERE report_id = ANY($1::text[])) as prg_cnt,
        (SELECT COUNT(*) FROM report_instructions WHERE report_id = ANY($1::text[])) as ins_cnt
      `,
      [deleteIds]
    );

    const c = countRes.rows[0];
    dependentCounts = {
      milestones: Number(c.ms_cnt || 0),
      approvals: Number(c.app_cnt || 0),
      approvalHistory: Number(c.aph_cnt || 0),
      distributions: Number(c.dst_cnt || 0),
      syncLogs: Number(c.sync_cnt || 0),
      notificationLogs: Number(c.ntf_cnt || 0),
      picHistory: Number(c.pic_cnt || 0),
      inspectionSubmissions: Number(c.insp_cnt || 0),
      confirmationDecisions: Number(c.dec_cnt || 0),
      evidence: Number(c.evd_cnt || 0),
      matchReviews: Number(c.mr_cnt || 0),
      reconCases: Number(c.rc_cnt || 0),
      reconAudit: Number(c.ra_cnt || 0),
      repairLinkHistory: Number(c.rlh_cnt || 0),
      repairLinks: Number(c.rl_cnt || 0),
      estimations: Number(c.est_cnt || 0),
      estimationRoutes: Number(c.rte_cnt || 0),
      progressPhotos: Number(c.php_cnt || 0),
      progressUpdates: Number(c.prg_cnt || 0),
      instructions: Number(c.ins_cnt || 0),
    };
  }

  console.log("  Tabel relasi yang terdampak:");
  for (const [key, count] of Object.entries(dependentCounts)) {
    if (count > 0) {
      console.log(`    • ${key.padEnd(25)} : ${count} baris data`);
    }
  }

  // 5. Audit Evidence Storage
  const storageRoot = path.join(process.cwd(), "storage");
  function walkFiles(dir: string): string[] {
    let files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        files = files.concat(walkFiles(full));
      } else {
        files.push(full);
      }
    }
    return files;
  }

  const allStorageFiles = walkFiles(storageRoot);
  const filesToDelete: string[] = [];
  const filesToRetain: string[] = [];

  for (const filePath of allStorageFiles) {
    const filename = path.basename(filePath);
    // Cek apakah file direferensikan oleh 5 laporan yang dipertahankan
    const isRetained = RETAINED_IDS.some((id) => filename.includes(id));
    if (isRetained) {
      filesToRetain.push(filePath);
    } else {
      filesToDelete.push(filePath);
    }
  }

  console.log(`\n  File Evidence Storage:`);
  console.log(`    • Total file saat ini      : ${allStorageFiles.length}`);
  console.log(`    • File yang dipertahankan  : ${filesToRetain.length}`);
  console.log(`    • File yang akan dihapus   : ${filesToDelete.length}`);

  // DRY-RUN MODE: Tampilkan output dan selesai
  if (options.dryRun) {
    console.log("\n================================================================================");
    console.log("  HASIL DRY-RUN (TIDAK ADA PERUBAHAN YANG DILAKUKAN KE DATABASE)");
    console.log("================================================================================");
    console.log("\n5 LAPORAN YANG AKAN DIPERTAHANKAN:");
    console.table(
      RETAINED_DEMO_REPORTS.map((r) => ({
        "No.": r.categoryNumber,
        "Kategori Demo": r.categoryTitle,
        "ID Laporan": r.id,
        Cabang: r.branch,
        "Lokasi / Fasilitas": r.name,
        Status: r.status,
        Progress: `${r.progress}%`,
        PIC: r.primaryPicName || r.primaryPicUserId || "-",
        Target: r.targetCompletion ? new Date(r.targetCompletion).toLocaleDateString("id-ID") : "-",
      }))
    );

    console.log("\nCONTOH 10 LAPORAN YANG AKAN DIHAPUS (DARI TOTAL " + totalToDelete + " LAPORAN):");
    console.table(
      reportsToDelete.slice(0, 10).map((r) => ({
        "ID Laporan": r.id,
        Cabang: r.branch,
        Lokasi: r.store_name,
        Status: r.status,
        Progress: `${r.progress}%`,
      }))
    );

    console.log("\nUntuk mengeksekusi penghapusan dan backup, jalankan:");
    console.log("  pnpm tsx scripts/cleanup-demo-reports.ts --apply --confirm-demo-cleanup\n");
    return;
  }

  // APPLY MODE: Validasi konfirmasi
  if (!options.apply || !options.confirm) {
    console.error("\n[DITOLAK] Mode eksekusi wajib menyertakan flag konfirmasi eksplisit:");
    console.error("  pnpm tsx scripts/cleanup-demo-reports.ts --apply --confirm-demo-cleanup\n");
    process.exit(1);
  }

  // 6. Jalankan Backup Lengkap Sebelum Mutasi
  console.log("\n[5/6] Menjalankan backup database dan storage sebelum penghapusan data...");
  const backupResult = await runDevelopmentBackup();
  if (!backupResult.success) {
    throw new Error(`[GAGAL] Backup gagal dilakukan: ${backupResult.error}. Proses dibatalkan demi keamanan!`);
  }
  console.log(`  ✓ Backup berhasil disimpan di: ${backupResult.backupDir}`);
  console.log(`  ✓ Manifest SHA-256           : ${backupResult.manifestFile}`);

  // 7. Eksekusi Atomic Transaction Cleanup
  console.log("\n[6/6] Menjalankan transaksi pembersihan relasi dan laporan...");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Hapus record turunan di tabel relasi (baik yang terkait laporan yang dihapus maupun orphan records)
    await client.query("DELETE FROM report_progress_photos WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_progress_updates WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_estimation_routes WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM estimations WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_instructions WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_distributions WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_confirmation_decisions WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_inspection_submissions WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_evidence WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_earthquake_match_reviews WHERE candidate_report_id NOT IN (SELECT id FROM incidents) OR candidate_report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM earthquake_reconciliation_audit WHERE incident_id NOT IN (SELECT id FROM incidents) OR incident_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM earthquake_reconciliation_cases WHERE incident_id NOT IN (SELECT id FROM incidents) OR incident_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_repair_link_history WHERE incident_id NOT IN (SELECT id FROM incidents) OR incident_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_repair_links WHERE incident_id NOT IN (SELECT id FROM incidents) OR incident_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM incident_pic_history WHERE incident_id NOT IN (SELECT id FROM incidents) OR incident_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_milestones WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_completion_approval_history WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM report_completion_approvals WHERE report_id NOT IN (SELECT id FROM incidents) OR report_id = ANY($1::text[])", [deleteIds]);
    await client.query("DELETE FROM integration_sync_logs WHERE (incident_id NOT IN (SELECT id FROM incidents) AND incident_id != 'ALL') OR incident_id = ANY($1::text[])", [deleteIds]);
    await client.query(
      "DELETE FROM notification_logs WHERE (disaster_id NOT IN (SELECT id FROM incidents) AND ticket_number NOT IN (SELECT id FROM incidents)) OR disaster_id = ANY($1::text[]) OR ticket_number = ANY($1::text[])",
      [deleteIds]
    );

    // 2. Hapus laporan utama yang tidak termasuk dalam 5 laporan pilihan
    if (deleteIds.length > 0) {
      const delRes = await client.query("DELETE FROM incidents WHERE id = ANY($1::text[])", [deleteIds]);
      console.log(`  ✓ Berhasil menghapus ${delRes.rowCount} laporan lama dari tabel 'incidents'.`);
    }

    // 3. Pastikan konfigurasi dan data snapshot 5 laporan demo terkalibrasi sempurna
    // Cat 1: Siap ditangani BMS (Alfamart Dago Plaza)
    await client.query(`
      UPDATE incidents
      SET location_kind = 'STORE',
          location_id = COALESCE(location_id, store_id, 'T-BDG-001'),
          location_code_snapshot = COALESCE(location_code_snapshot, store_id, 'T-BDG-001'),
          location_name_snapshot = 'Alfamart Dago Plaza',
          status = 'confirmed_affected',
          progress = 0,
          primary_pic_user_id = NULL,
          primary_pic_claimed_at = NULL,
          updated_at = NOW()
      WHERE id = 'INC-HTTP-BDG-1791869681432'
    `);

    // Cat 2: On Progress dengan PIC dan Target (Alfamart Dago Asri 777)
    await client.query(`
      UPDATE incidents
      SET location_kind = 'STORE',
          location_id = COALESCE(location_id, store_id, 'T-BDG-777'),
          location_code_snapshot = COALESCE(location_code_snapshot, store_id, 'T-BDG-777'),
          location_name_snapshot = 'Alfamart Dago Asri 777',
          status = 'in_maintenance',
          progress = 50,
          primary_pic_user_id = 'USR-BMS-001',
          primary_pic_claimed_at = NOW(),
          maintenance_ticket = jsonb_build_object(
            'ticketId', 'MTC-BDG-2026-002',
            'completedAt', '2026-10-25T17:00:00.000Z',
            'assignedTechnician', 'Demo BMS Bandung',
            'status', 'in_progress'
          ),
          updated_at = NOW()
      WHERE id = 'INC-API-TOKO-1791864995272'
    `);

    // Cat 3: Memerlukan konfirmasi BM (Alfamart Dago Bandung)
    await client.query(`
      UPDATE incidents
      SET location_kind = 'STORE',
          location_id = COALESCE(location_id, store_id, 'T-BDG-001'),
          location_code_snapshot = COALESCE(location_code_snapshot, store_id, 'T-BDG-001'),
          location_name_snapshot = 'Alfamart Dago Bandung',
          status = 'pending_bm_approval',
          progress = 0,
          primary_pic_user_id = NULL,
          primary_pic_claimed_at = NULL,
          updated_at = NOW()
      WHERE id = 'INC-SPRINT-TOKO-1791971633374-UNAPPROVED'
    `);

    // Cat 4: Fasilitas/DC untuk BES (Distribution Center Soekarno Hatta)
    await client.query(`
      UPDATE incidents
      SET location_kind = 'FACILITY',
          tkp_type = 'dc',
          store_id = 'DC-BDG-01',
          location_id = 'DC-BDG-01',
          location_code_snapshot = 'DC-BDG-01',
          location_name_snapshot = 'Distribution Center Soekarno Hatta',
          status = 'in_maintenance',
          progress = 10,
          updated_at = NOW()
      WHERE id = 'INC-SPRINT-DC-1791971633374'
    `);

    // Cat 5: Selesai (Alfamart Setiabudi 99)
    await client.query(`
      UPDATE incidents
      SET location_kind = 'STORE',
          location_id = COALESCE(location_id, store_id, 'T-BDG-099'),
          location_code_snapshot = COALESCE(location_code_snapshot, store_id, 'T-BDG-099'),
          location_name_snapshot = 'Alfamart Setiabudi 99',
          status = 'closed',
          progress = 100,
          closed_at = '2026-10-14T09:54:00.626Z',
          updated_at = NOW()
      WHERE id = 'INC-SPRINT-TOKO-1791971633374'
    `);

    await client.query("COMMIT");
    console.log("  ✓ Transaksi database BERHASIL di-commit secara atomik.");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("  ❌ Terjadi kesalahan pada transaksi. Rollback berhasil dilakukan.", err);
    throw err;
  } finally {
    client.release();
  }

  // 8. Hapus file evidence storage orphaned
  console.log("\n  Membersihkan file evidence storage...");
  let deletedFilesCount = 0;
  for (const f of filesToDelete) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        deletedFilesCount++;
      }
    } catch {
      // Ignore single file unlink error
    }
  }
  console.log(`  ✓ Berhasil membersihkan ${deletedFilesCount} file evidence orphaned.`);

  // 9. Verifikasi Pasca Cleanup Langsung dari Database
  console.log("\n================================================================================");
  console.log("  VERIFIKASI DATABASE PASCA CLEANUP");
  console.log("================================================================================");

  const finalRes = await pool.query(`
    SELECT 
      i.id,
      i.branch,
      COALESCE(i.location_name_snapshot, i.store_name) AS store_name,
      i.location_kind,
      i.tkp_type,
      i.status,
      i.progress,
      i.primary_pic_user_id,
      u.name AS primary_pic_name,
      i.maintenance_ticket->>'completedAt' AS target_completion,
      i.closed_at
    FROM incidents i
    LEFT JOIN users u ON u.id = i.primary_pic_user_id
    ORDER BY i.created_at DESC
  `);

  const finalRows = finalRes.rows;
  console.log(`  ✓ Jumlah laporan akhir di database : ${finalRows.length} (Target: tepat 5)`);

  if (finalRows.length !== 5) {
    console.error(`  ❌ PERINGATAN: Jumlah laporan (${finalRows.length}) tidak tepat 5!`);
  } else {
    console.log("  ✓ VALIDASI BERHASIL: Tepat 5 laporan tersimpan di database.");
  }

  console.table(
    finalRows.map((r, idx) => ({
      No: idx + 1,
      "ID Laporan": r.id,
      Cabang: r.branch,
      Lokasi: r.store_name,
      Tipe: `${r.location_kind || "-"}/${r.tkp_type || "-"}`,
      Status: r.status,
      Progress: `${r.progress}%`,
      PIC: r.primary_pic_name || r.primary_pic_user_id || "-",
      Target: r.target_completion ? new Date(r.target_completion).toLocaleDateString("id-ID") : "-",
    }))
  );

  console.log("\n================================================================================");
  console.log("  CLEANUP DEMO BERHASIL DILAKUKAN SECARA LENGKAP & AMAN!");
  console.log("================================================================================\n");
}

// ============================================================================
// CLI ENTRYPOINT
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isApply = args.includes("--apply");
  const isConfirm = args.includes("--confirm-demo-cleanup");

  if (!isDryRun && !isApply) {
    console.log("\n=================================================================");
    console.log("  SPARTA SIAGA - SCRIPT DATABASE CLEANUP UNTUK DEMO RAPAT");
    console.log("=================================================================");
    console.log("Penggunaan:");
    console.log("  1. Periksa daftar data yang akan dipertahankan dan dihapus (Dry-Run):");
    console.log("     pnpm tsx scripts/cleanup-demo-reports.ts --dry-run\n");
    console.log("  2. Eksekusi pembersihan setelah backup berhasil:");
    console.log("     pnpm tsx scripts/cleanup-demo-reports.ts --apply --confirm-demo-cleanup\n");
    process.exit(0);
  }

  try {
    await runDemoCleanup({
      dryRun: isDryRun,
      apply: isApply,
      confirm: isConfirm,
    });
  } catch (err: any) {
    console.error("\n[FATAL ERROR] Cleanup dibatalkan karena error:", err?.message || err);
    process.exit(1);
  } finally {
    await closeDbPool();
  }
}

if (process.argv[1]?.endsWith("cleanup-demo-reports.ts")) {
  main();
}
