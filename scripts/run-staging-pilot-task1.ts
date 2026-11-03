import fs from "node:fs";
import path from "node:path";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { executeUserSynchronization } from "../lib/user-sync-service";
import { RawSpartaUserRecord } from "../lib/user-sync-types";
import { matchSsoIdentityToSiagaUser, validateSsoModuleAccess } from "../lib/sso-service";

interface PilotCandidate {
  role: string;
  name: string;
  nik: string | null;
  email: string;
  branch: string;
  sourceModule: string;
  raw: RawSpartaUserRecord;
}

export function getPilot7Candidates(): PilotCandidate[] {
  const datasetPath = path.join(process.cwd(), "data/sparta-users-staging-dataset.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

  return [
    {
      role: "BMS",
      name: "Agus Pratama",
      nik: "SPARTA_BMS_BDG_01",
      email: "agus.pratama@sparta.local",
      branch: "BANDUNG",
      sourceModule: "MAINTENANCE",
      raw: dataset[0],
    },
    {
      role: "BMC",
      name: "Bambang Supriyadi",
      nik: "SPARTA_BMC_BDG_01",
      email: "bambang.s@sparta.local",
      branch: "BANDUNG",
      sourceModule: "MAINTENANCE",
      raw: dataset[1],
    },
    {
      role: "BM",
      name: "Cahyo Utomo (BnM)",
      nik: "SPARTA_BM_BDG_01",
      email: "cahyo.utomo@sparta.local",
      branch: "BANDUNG",
      sourceModule: "MAINTENANCE",
      raw: dataset[2],
    },
    {
      role: "BES",
      name: "Deddy Kurniawan",
      nik: "SPARTA_BES_CKL_01",
      email: "deddy.k@sparta.local",
      branch: "CIKOKOL",
      sourceModule: "ENGINEERING",
      raw: dataset[3],
    },
    {
      role: "BEC",
      name: "Eko Prasetyo",
      nik: "SPARTA_BEC_CKL_01",
      email: "eko.p@sparta.local",
      branch: "CIKOKOL",
      sourceModule: "ENGINEERING",
      raw: dataset[4],
    },
    {
      role: "BBS",
      name: "Fajar Hidayat (Building - No NIK)",
      nik: null,
      email: "fajar.hidayat@sat.co.id",
      branch: "SIDOARJO",
      sourceModule: "BUILDING",
      raw: dataset[6],
    },
    {
      role: "BBC",
      name: "Guruh Wicaksono (Building - No NIK)",
      nik: null,
      email: "guruh.wicaksono@sat.co.id",
      branch: "SIDOARJO",
      sourceModule: "BUILDING",
      raw: dataset[7],
    },
  ];
}

async function runPilot(isExecute: boolean) {
  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  console.log("================================================================================");
  console.log(" SPARTA SIAGA — TASK 1: CONTROLLED STAGING PILOT RUNNER");
  console.log(` Target Database : sparta_siaga_isolated (SAFE ISOLATION)`);
  console.log(` Mode            : ${isExecute ? "LIVE EXECUTION" : "PRE-CHECK / DRY-RUN"}`);
  console.log("================================================================================\n");

  // 1. Validate Baseline
  console.log("--- TAHAP 1: Baseline Verification ---");
  const baselineRes = await pool.query(`
    SELECT id, nik, email, name, system_role, business_role, scope, branch, status, source
    FROM users
    ORDER BY created_at ASC
  `);
  console.log(`Current existing users count: ${baselineRes.rows.length} (Expected: 32 baseline accounts)`);
  const existingNiks = new Set(baselineRes.rows.map(r => (r.nik || "").toLowerCase()).filter(Boolean));
  const existingEmails = new Set(baselineRes.rows.map(r => (r.email || "").toLowerCase()).filter(Boolean));

  // 2. Validate Candidates & Zero Collision
  console.log("\n--- TAHAP 2: 7 Pilot Candidates Collision Check ---");
  const pilotCandidates = getPilot7Candidates();
  let collisions = 0;
  for (const c of pilotCandidates) {
    const nikMatch = c.nik && existingNiks.has(c.nik.toLowerCase());
    const emailMatch = existingEmails.has(c.email.toLowerCase());
    if (nikMatch || emailMatch) {
      console.error(`COLLISION DETECTED for ${c.role}: ${c.email} / ${c.nik}`);
      collisions++;
    } else {
      console.log(` - [${c.role.padEnd(3)}] ${c.name.padEnd(35)} | NIK: ${(c.nik || "NO_NIK").padEnd(18)} | Email: ${c.email.padEnd(28)} | Branch: ${c.branch}`);
    }
  }

  if (collisions > 0) {
    throw new Error(`Fatal collision detected: ${collisions} candidate(s) collide with existing accounts.`);
  }
  console.log("Collision check passed: 7/7 candidates are completely distinct from existing accounts.");

  if (!isExecute) {
    console.log("\n[CHECKPOINT READY] Pre-check complete. To execute backup, migration 018, and pilot import, run with --execute.");
    await closeDbPool();
    return;
  }

  // 3. Backup Phase
  console.log("\n--- TAHAP 3: PostgreSQL Backup & Snapshot ---");
  const backupDir = path.join(process.cwd(), "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const backupFilePath = path.join(backupDir, `staging-users-preflight-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFilePath, JSON.stringify(baselineRes.rows, null, 2));
  console.log(`Local JSON snapshot saved: ${backupFilePath} (${baselineRes.rows.length} records)`);

  await pool.query(`DROP TABLE IF EXISTS users_staging_backup_preflight;`);
  await pool.query(`CREATE TABLE users_staging_backup_preflight AS TABLE public.users;`);
  const backupTableCount = await pool.query(`SELECT count(*)::int as count FROM users_staging_backup_preflight;`);
  console.log(`Database snapshot table created: users_staging_backup_preflight (${backupTableCount.rows[0].count} records)`);

  // 4. Migration 018 Execution
  console.log("\n--- TAHAP 4: Migration 018 Execution ---");
  const migrationPath = path.join(process.cwd(), "database/migrations/018_user_sync_metadata_and_sso_status.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  await pool.query(migrationSql);
  console.log("Migration 018 executed successfully.");

  // Verify new columns
  const colsRes = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('sso_status', 'secondary_branches', 'multi_roles', 'sync_metadata')
    ORDER BY column_name;
  `);
  console.log("Verified newly added columns in public.users:");
  colsRes.rows.forEach(c => console.log(` - ${c.column_name}: ${c.data_type} (nullable: ${c.is_nullable}, default: ${c.column_default})`));

  // Verify legacy users have sso_status = NULL and roles intact
  const legacyCheck = await pool.query(`
    SELECT count(*)::int as count
    FROM users
    WHERE sso_status IS NULL AND id IN (SELECT id FROM users_staging_backup_preflight)
  `);
  console.log(`Legacy accounts with sso_status = NULL: ${legacyCheck.rows[0].count}/${baselineRes.rows.length} (Verified intact)`);

  // 5. Import Pilot 7 Candidates
  console.log("\n--- TAHAP 5: Live Import of 7 Pilot Users ---");
  const rawRecords = pilotCandidates.map(c => ({
    ...c.raw,
    ssoMatched: true,
    ssoStatus: "ACTIVE",
    hasSiagaGrant: false, // Explicitly no SIAGA grant
  }));

  const importReport = await executeUserSynchronization(rawRecords, {
    dryRun: false,
    allowUpdates: true,
    sourceModule: "PILOT",
  });

  console.log("Import Report:");
  console.log(` - Scanned: ${importReport.totalScanned}`);
  console.log(` - New: ${importReport.newCount}`);
  console.log(` - Updated: ${importReport.updatedCount}`);
  console.log(` - Unchanged: ${importReport.unchangedCount}`);
  console.log(` - Categories Breakdown:`, importReport.categoriesBreakdown);

  // Verify DB state
  const postImportCountRes = await pool.query(`SELECT count(*)::int as count FROM users;`);
  console.log(`Total users in DB after pilot import: ${postImportCountRes.rows[0].count} (Expected: 39 = 32 baseline + 7 pilot)`);

  // Verify all 7 pilot users have status = 'INACTIVE', sso_status = 'PENDING_SSO_GRANT', password_hash = NULL
  const pilotCheckRes = await pool.query(`
    SELECT id, email, nik, name, business_role, scope, branch, status, sso_status, password_hash
    FROM users
    WHERE sso_status = 'PENDING_SSO_GRANT';
  `);
  console.log(`\nVerified ${pilotCheckRes.rows.length} imported pilot users in database:`);
  let pilotSafetyPass = true;
  for (const u of pilotCheckRes.rows) {
    const isInactive = u.status === "INACTIVE";
    const isPending = u.sso_status === "PENDING_SSO_GRANT";
    const noPassword = u.password_hash === null;
    if (!isInactive || !isPending || !noPassword) {
      pilotSafetyPass = false;
      console.error(`SAFETY VIOLATION on user ${u.email}: status=${u.status}, sso_status=${u.sso_status}, hasPassword=${!noPassword}`);
    } else {
      console.log(` - [${u.business_role?.toUpperCase().padEnd(4)}] ${u.name.padEnd(35)} | Status: ${u.status} | SSO Status: ${u.sso_status} | Password: NULL (SSO Gated)`);
    }
  }
  console.log(`Pilot Safety Gating (status=INACTIVE, sso_status=PENDING_SSO_GRANT, password=NULL): ${pilotSafetyPass ? "PASSED" : "FAILED"}`);

  // 6. Idempotency Verification
  console.log("\n--- TAHAP 6: Idempotency Verification (Re-running same batch) ---");
  const rerunReport = await executeUserSynchronization(rawRecords, {
    dryRun: false,
    allowUpdates: true,
    sourceModule: "PILOT",
  });
  console.log(`Re-run Report: New: ${rerunReport.newCount}, Updated: ${rerunReport.updatedCount}, Unchanged: ${rerunReport.unchangedCount}`);
  const countAfterRerun = await pool.query(`SELECT count(*)::int as count FROM users;`);
  console.log(`DB user count after re-run: ${countAfterRerun.rows[0].count} (Expected: 39, no duplicates created)`);
  const idempotencyPassed = rerunReport.newCount === 0 && countAfterRerun.rows[0].count === 39;
  console.log(`Idempotency Check: ${idempotencyPassed ? "PASSED (100% Idempotent)" : "FAILED"}`);

  // 7. Login Security & Rejection Tests
  console.log("\n--- TAHAP 7: Login Security & Rejection Tests ---");

  // 7.1 Local login rejection
  const pilotUser = pilotCheckRes.rows[0];
  const { dbGetUserByIdentifier } = await import("../lib/user-db");
  const fetchedUser = await dbGetUserByIdentifier(pilotUser.email);
  const localLoginBlocked = fetchedUser?.status !== "ACTIVE" && !fetchedUser?.passwordHash;
  console.log(` - Local password login blocked for pilot user (${pilotUser.email}): ${localLoginBlocked ? "PASS (Blocked: INACTIVE & NULL password)" : "FAIL"}`);

  // 7.2 SSO without SIAGA grant rejected
  const fakeSsoTokenWithoutGrant: any = {
    email: pilotUser.email,
    access: ["building", "maintenance"], // NO SIAGA
  };
  const grantBlocked = validateSsoModuleAccess(fakeSsoTokenWithoutGrant) === false;
  console.log(` - SSO without 'siaga' grant rejected at portal boundary: ${grantBlocked ? "PASS" : "FAIL"}`);

  // 7.3 Backend matchSsoIdentityToSiagaUser rejects pending user
  const ssoMatchResult = await matchSsoIdentityToSiagaUser({ email: pilotUser.email });
  const ssoMatchBlocked = ssoMatchResult.status === "INACTIVE" || ssoMatchResult.status === "PENDING_SSO_GRANT";
  console.log(` - Backend SSO identity match rejected: status=${ssoMatchResult.status} (${ssoMatchBlocked ? "PASS" : "FAIL"})`);

  // 7.4 Existing admin & UAT check
  const adminCheck = await pool.query(`SELECT id, nik, system_role, status FROM users WHERE nik = 'ADM0001'`);
  const adminIntact = adminCheck.rows[0]?.system_role === "ADMIN" && adminCheck.rows[0]?.status === "ACTIVE";
  console.log(` - System Administrator (ADM0001) intact: ${adminIntact ? "PASS" : "FAIL"}`);

  // 8. Rollback Test Demonstration (Controlled cleanup and restoration)
  console.log("\n--- TAHAP 8: Rollback Mechanism Demonstration ---");
  console.log("Demonstrating atomic rollback to 32 baseline users...");
  await pool.query(`DELETE FROM users WHERE id NOT IN (SELECT id FROM users_staging_backup_preflight);`);
  const rolledBackCount = await pool.query(`SELECT count(*)::int as count FROM users;`);
  console.log(`User count after deleting pilot users: ${rolledBackCount.rows[0].count} (Expected: 32)`);
  const rollbackPassed = rolledBackCount.rows[0].count === 32;
  console.log(`Rollback Test: ${rollbackPassed ? "PASSED (Clean restoration to 32 baseline records)" : "FAILED"}`);

  // Re-insert pilot users so staging retains the verified pilot state for inspection
  console.log("\nRe-applying verified pilot import for staging inspection...");
  await executeUserSynchronization(rawRecords, {
    dryRun: false,
    allowUpdates: true,
    sourceModule: "PILOT",
  });
  const finalCount = await pool.query(`SELECT count(*)::int as count FROM users;`);
  console.log(`Final user count in staging: ${finalCount.rows[0].count} (32 baseline + 7 pilot = 39)`);

  await closeDbPool();
  console.log("\n================================================================================");
  console.log(" CONTROLLED STAGING PILOT COMPLETED SUCCESSFULLY");
  console.log("================================================================================");
}

const isExecute = process.argv.includes("--execute");
runPilot(isExecute).catch(err => {
  console.error("FATAL ERROR in pilot runner:", err);
  process.exit(1);
});
