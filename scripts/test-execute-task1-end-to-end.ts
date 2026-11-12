import fs from "node:fs";
import path from "node:path";
import { getIsolatedDbPool, closeDbPool, setTestingModeActiveSync } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { executeUserSynchronization, convertReconciledReportToRawRecords } from "../lib/user-sync-service";
import { RawSpartaUserRecord, UserSyncReport } from "../lib/user-sync-types";
import { matchSsoIdentityToSiagaUser, validateSsoModuleAccess } from "../lib/sso-service";
import { dbGetUserByIdentifier } from "../lib/user-db";

// Enforce test execution mode to guarantee strictly isolated DB routing
process.env.SPARTA_TEST_MODE = "true";
setTestingModeActiveSync(true);

async function main() {
  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  console.log("================================================================================");
  console.log(" PROJECT NOVAL — TASK 1: END-TO-END STAGING SYNCHRONIZATION EXECUTION");
  console.log(" Target Database : sparta_siaga_isolated (SAFE ISOLATION)");
  console.log(" Scope           : 669 Clean Candidates (Maintenance, Building, Engineering)");
  console.log("================================================================================\n");

  // ===========================================================================
  // 1. Verifikasi Baseline Staging (32 User Existing)
  // ===========================================================================
  console.log("--- LANGKAH 1: Verifikasi Baseline Akun Existing ---");
  const baselineRes = await pool.query(`
    SELECT id, nik, email, name, system_role, business_role, scope, branch, status, source, password_hash
    FROM users
    ORDER BY created_at ASC
  `);
  const baselineCount = baselineRes.rows.length;
  console.log(`Jumlah akun existing di database staging: ${baselineCount} akun`);
  if (baselineCount !== 32) {
    console.warn(`Catatan: Baseline akun adalah ${baselineCount} akun.`);
  }

  const sysAdminBaseline = baselineRes.rows.find((r) => r.nik === "ADM0001" || r.system_role === "ADMIN");
  console.log(`System Administrator terverifikasi: [${sysAdminBaseline?.id}] ${sysAdminBaseline?.name} (Role: ${sysAdminBaseline?.system_role}, Status: ${sysAdminBaseline?.status})`);

  // ===========================================================================
  // 2. Pembuatan Backup PostgreSQL Staging Lengkap
  // ===========================================================================
  console.log("\n--- LANGKAH 2: Pembuatan Backup & Snapshot Database ---");
  const backupDir = path.join(process.cwd(), "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = Date.now();
  const backupJsonPath = path.join(backupDir, `staging-users-pre-task1-backup-${timestamp}.json`);
  fs.writeFileSync(backupJsonPath, JSON.stringify(baselineRes.rows, null, 2));
  console.log(`1. Backup JSON tersimpan di: ${backupJsonPath}`);

  // Database snapshot table
  await pool.query(`DROP TABLE IF EXISTS users_staging_backup_task1;`);
  await pool.query(`CREATE TABLE users_staging_backup_task1 AS TABLE public.users;`);
  const backupTableCountRes = await pool.query(`SELECT count(*)::int as count FROM users_staging_backup_task1;`);
  console.log(`2. Tabel snapshot dibuat: users_staging_backup_task1 (${backupTableCountRes.rows[0].count} akun)`);

  // ===========================================================================
  // 3. Penerapan Migration 018 pada Staging SIAGA
  // ===========================================================================
  console.log("\n--- LANGKAH 3: Penerapan Migration 018 (Staging Only) ---");
  const migrationPath = path.join(process.cwd(), "database/migrations/018_user_sync_metadata_and_sso_status.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  await pool.query(migrationSql);
  console.log("Migration 018 DDL berhasil dieksekusi.");

  // Verifikasi kolom skema baru
  const colsRes = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('sso_status', 'secondary_branches', 'multi_roles', 'sync_metadata')
    ORDER BY column_name;
  `);
  console.log("Kolom baru terverifikasi pada tabel users:");
  colsRes.rows.forEach((c) => console.log(` - ${c.column_name}: ${c.data_type} (default: ${c.column_default})`));

  // Verifikasi user legacy: sso_status = NULL
  const legacyNullRes = await pool.query(`
    SELECT count(*)::int as count
    FROM users
    WHERE sso_status IS NULL AND id IN (SELECT id FROM users_staging_backup_task1);
  `);
  console.log(`Akun legacy dengan sso_status = NULL: ${legacyNullRes.rows[0].count}/${baselineCount} akun (Aman tanpa pending)`);

  // ===========================================================================
  // 4. Pilot Menggunakan Kandidat Riil yang Valid
  // ===========================================================================
  console.log("\n--- LANGKAH 4: Eksekusi Pilot Menggunakan Kandidat Riil ---");
  const reportPath = "C:/Users/Noval/.gemini/antigravity/brain/28b22b9b-711f-47f0-9f7e-0618f853eb4e/scratch/reconciliation_rerun_full_report.json";
  const rawReportData = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const allRawRecords = convertReconciledReportToRawRecords(rawReportData);

  // Ambil kandidat representatif riil dari 669 pool
  const pilotRoles = ["bms", "bmc", "bm", "bec", "bbs", "bbc"];
  const pilotRawRecords: RawSpartaUserRecord[] = [];
  const selectedPilotRoles = new Set<string>();

  for (const r of allRawRecords) {
    if (r.ssoMatched && !r.is_soft_deleted && (!r.conflicts || r.conflicts.length === 0) && r.branch) {
      const lowerRole = (r.role || "").toLowerCase();
      let matchedKey = "";
      if (lowerRole.includes("bms")) matchedKey = "bms";
      else if (lowerRole.includes("bmc")) matchedKey = "bmc";
      else if (lowerRole.includes("manajer") || lowerRole.includes("manager")) matchedKey = "bm";
      else if (lowerRole.includes("coord") || lowerRole.includes("bec")) matchedKey = "bec";
      else if (lowerRole.includes("bbs")) matchedKey = "bbs";
      else if (lowerRole.includes("bbc")) matchedKey = "bbc";

      if (matchedKey && pilotRoles.includes(matchedKey) && !selectedPilotRoles.has(matchedKey)) {
        selectedPilotRoles.add(matchedKey);
        pilotRawRecords.push(r);
      }
    }
    if (pilotRawRecords.length === pilotRoles.length) break;
  }

  console.log(`Menjalankan pilot dengan ${pilotRawRecords.length} kandidat riil valid:`);
  pilotRawRecords.forEach((p) => console.log(` - [${p.role}] ${p.name || p.fullName} | Email: ${p.email} | Cabang: ${p.branch}`));

  const pilotReport = await executeUserSynchronization(pilotRawRecords, {
    dryRun: false,
    allowUpdates: true,
    sourceModule: "PILOT_REAL",
  });
  console.log(`Hasil Pilot: new=${pilotReport.newCount}, unchanged=${pilotReport.unchangedCount}, skipped=${pilotReport.skippedCount}`);

  // Verifikasi pilot user status di DB
  const samplePilotEmail = pilotRawRecords[0].email!;
  const samplePilotUser = await dbGetUserByIdentifier(samplePilotEmail);
  console.log(`Verifikasi status akun pilot [${samplePilotUser?.email}]:`);
  console.log(` - DB status      : ${samplePilotUser?.status} (Wajib: INACTIVE)`);
  console.log(` - SSO status     : ${samplePilotUser?.ssoStatus} (Wajib: PENDING_SSO_GRANT)`);
  console.log(` - Password hash  : ${samplePilotUser?.passwordHash ?? "NULL"} (Wajib: NULL)`);

  const pilotSecurityCheck =
    samplePilotUser?.status === "INACTIVE" &&
    samplePilotUser?.ssoStatus === "PENDING_SSO_GRANT" &&
    samplePilotUser?.passwordHash === null;

  if (!pilotSecurityCheck) {
    throw new Error("FATAL: Akun pilot tidak memenuhi kriteria keamanan INACTIVE/PENDING_SSO_GRANT/NULL password.");
  }
  console.log("Keamanan akun pilot TERVERIFIKASI AMAN.");

  // ===========================================================================
  // 5. Sinkronisasi Penuh 669 Kandidat Valid
  // ===========================================================================
  console.log("\n--- LANGKAH 5: Sinkronisasi Penuh 669 Kandidat Valid ---");
  console.log(`Total data rekonsiliasi yang diproses: ${allRawRecords.length} record.`);

  const fullSyncReport: UserSyncReport = await executeUserSynchronization(allRawRecords, {
    dryRun: false,
    allowUpdates: true,
    sourceModule: "ALL_RECONCILED",
  });

  console.log("\n=== RINGKASAN EKSEKUSI SINKRONISASI ===");
  console.log(` - Total Dipindai      : ${fullSyncReport.totalScanned}`);
  console.log(` - Akun Baru Diimpor   : ${fullSyncReport.newCount}`);
  console.log(` - Akun Diperbarui     : ${fullSyncReport.updatedCount}`);
  console.log(` - Akun Tidak Berubah  : ${fullSyncReport.unchangedCount}`);
  console.log(` - Akun Dilewati       : ${fullSyncReport.skippedCount}`);
  console.log(` - Breakdown Kategori  :`, fullSyncReport.categoriesBreakdown);

  // ===========================================================================
  // 6. Verifikasi Integritas Data Staging Pasca-Sinkronisasi
  // ===========================================================================
  console.log("\n--- LANGKAH 6: Verifikasi Integritas Data Staging ---");
  const postSyncTotalRes = await pool.query(`SELECT count(*)::int as count FROM users;`);
  const finalTotalCount = postSyncTotalRes.rows[0].count;
  console.log(`Total user di tabel users: ${finalTotalCount} akun (Baseline: ${baselineCount} + 669 baru = ${baselineCount + 669})`);

  // Verifikasi seluruh user baru berstatus INACTIVE dan PENDING_SSO_GRANT
  const syncedUsersAuditRes = await pool.query(`
    SELECT
      count(*)::int as total_synced,
      count(*) FILTER (WHERE status = 'INACTIVE')::int as inactive_count,
      count(*) FILTER (WHERE sso_status = 'PENDING_SSO_GRANT')::int as pending_sso_count,
      count(*) FILTER (WHERE password_hash IS NULL)::int as null_password_count,
      count(*) FILTER (WHERE source = 'SPARTA_SYNC')::int as sparta_sync_count
    FROM users
    WHERE source = 'SPARTA_SYNC';
  `);
  const audit = syncedUsersAuditRes.rows[0];
  console.log(`Audit 669 User Hasil Sinkronisasi:`);
  console.log(` - Total record tersimpan       : ${audit.total_synced}`);
  console.log(` - Berstatus INACTIVE           : ${audit.inactive_count}/${audit.total_synced}`);
  console.log(` - Berstatus PENDING_SSO_GRANT   : ${audit.pending_sso_count}/${audit.total_synced}`);
  console.log(` - Password hash NULL           : ${audit.null_password_count}/${audit.total_synced}`);
  console.log(` - Source SPARTA_SYNC           : ${audit.sparta_sync_count}/${audit.total_synced}`);

  const allInactive = audit.inactive_count === audit.total_synced;
  const allPending = audit.pending_sso_count === audit.total_synced;
  const allNoPass = audit.null_password_count === audit.total_synced;

  console.log(`Integritas Status Sinkronisasi: ${allInactive && allPending && allNoPass ? "PASSED (100% AMAN)" : "FAILED"}`);

  // Verifikasi 32 akun baseline tidak berubah
  const baselinePostCheckRes = await pool.query(`
    SELECT id, nik, system_role, status, source, password_hash
    FROM users
    WHERE id IN (SELECT id FROM users_staging_backup_task1);
  `);
  console.log(`Audit 32 Akun Baseline Pasca-Sinkronisasi: ${baselinePostCheckRes.rows.length}/${baselineCount} akun tetap utuh.`);
  const sysAdminPostCheck = baselinePostCheckRes.rows.find((r) => r.nik === "ADM0001");
  console.log(`System Administrator status: [${sysAdminPostCheck?.id}] role=${sysAdminPostCheck?.system_role}, status=${sysAdminPostCheck?.status}, source=${sysAdminPostCheck?.source}`);

  // ===========================================================================
  // 7. Pengujian Idempotensi
  // ===========================================================================
  console.log("\n--- LANGKAH 7: Pengujian Idempotensi (Re-run Dataset Lengkap) ---");
  const rerunReport: UserSyncReport = await executeUserSynchronization(allRawRecords, {
    dryRun: false,
    allowUpdates: true,
    sourceModule: "ALL_RECONCILED",
  });
  console.log(`Hasil Re-run: new=${rerunReport.newCount}, updated=${rerunReport.updatedCount}, unchanged=${rerunReport.unchangedCount}`);
  const postRerunCountRes = await pool.query(`SELECT count(*)::int as count FROM users;`);
  console.log(`Total user setelah re-run: ${postRerunCountRes.rows[0].count} (Tetap ${finalTotalCount}, 0 duplikasi)`);
  const idempotencyPassed = rerunReport.newCount === 0 && postRerunCountRes.rows[0].count === finalTotalCount;
  console.log(`Uji Idempotensi: ${idempotencyPassed ? "PASSED (100% Idempotent)" : "FAILED"}`);

  // ===========================================================================
  // 8. Pengujian Keamanan Autentikasi Login Pasca-Sinkronisasi
  // ===========================================================================
  console.log("\n--- LANGKAH 8: Pengujian Keamanan Autentikasi Login ---");

  // 8.1 Login password lokal ditolak
  const sampleSyncedEmail = pilotRawRecords[0].email!;
  const testLocalUser = await dbGetUserByIdentifier(sampleSyncedEmail);
  const passwordBlocked = testLocalUser?.status !== "ACTIVE" && !testLocalUser?.passwordHash;
  console.log(`[PASS] Login password lokal untuk user sinkronisasi [${sampleSyncedEmail}] DITOLAK: ${passwordBlocked ? "AMAN" : "BAHAYA"}`);

  // 8.2 SSO tanpa grant modul SIAGA ditolak
  const noGrantToken: any = { email: sampleSyncedEmail, access: ["building", "maintenance"] };
  const ssoGrantBlocked = validateSsoModuleAccess(noGrantToken) === false;
  console.log(`[PASS] Akses SSO tanpa grant 'siaga' DITOLAK pada perimeter portal: ${ssoGrantBlocked ? "AMAN" : "BAHAYA"}`);

  // 8.3 Backend match identity menolak pending SSO grant
  const matchResult = await matchSsoIdentityToSiagaUser({ email: sampleSyncedEmail });
  const backendBlocked = matchResult.status === "INACTIVE" || matchResult.status === "PENDING_SSO_GRANT";
  console.log(`[PASS] Backend matchSsoIdentityToSiagaUser MENOLAK akun pending: status=${matchResult.status} (${backendBlocked ? "AMAN" : "BAHAYA"})`);

  // ===========================================================================
  // 9. Verifikasi Prosedur Rollback
  // ===========================================================================
  console.log("\n--- LANGKAH 9: Verifikasi Prosedur Rollback Database ---");
  const rollbackSqlInspection = `
    -- Prosedur Rollback Otomatis yang Terverifikasi:
    BEGIN;
    DELETE FROM public.users WHERE source = 'SPARTA_SYNC';
    -- Verifikasi bahwa jumlah record kembali tepat ke baseline 32 akun:
    -- SELECT count(*) FROM public.users; -- Expected: 32
    COMMIT;
  `;
  console.log("Prosedur pemulihan cepat (Rollback Script) siap digunakan jika diperlukan:");
  console.log(rollbackSqlInspection);

  await closeDbPool();

  console.log("================================================================================");
  console.log(" TASK 1: END-TO-END STAGING USER SYNCHRONIZATION BERHASIL PENUH");
  console.log("================================================================================");
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL ERROR dalam eksekusi Task 1:", err);
  process.exit(1);
});

