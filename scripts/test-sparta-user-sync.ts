import fs from "node:fs";
import path from "node:path";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import {
  executeUserSynchronization,
  validateAndNormalizeSpartaUser,
  resolveApprovedSiagaRole,
  parseSpartaUserCsv,
  assertProductionUserSyncSafety,
} from "../lib/user-sync-service";
import {
  FINALIZED_SIAGA_BUSINESS_ROLES,
  RawSpartaUserRecord,
} from "../lib/user-sync-types";

interface TestResult {
  code: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function record(res: TestResult) {
  results.push(res);
  const statusStr = res.passed ? "PASS" : "FAIL";
  console.log(`[${statusStr}] ${res.code.padEnd(8)} | ${res.name.padEnd(48)} | ${res.details || ""}`);
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — TASK 1: FINAL TARGETED VERIFICATION & CLOSURE");
  console.log(" Target: Aiven sparta_siaga_isolated (Isolated Staging)");
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  // ---------------------------------------------------------------------------
  // SUITE 1: 9 Finalized SIAGA Roles & Approved Role Mapping
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 1: Approved Role Mapping to 9 Finalized SIAGA Roles ---");

  // 1.1 Maintenance roles: BMS, BMC, BNM_MANAJER -> bm
  {
    const bms = resolveApprovedSiagaRole("BMS", "MAINTENANCE");
    const bmc = resolveApprovedSiagaRole("BMC", "MAINTENANCE");
    const bm = resolveApprovedSiagaRole("BNM_MANAJER", "MAINTENANCE");
    const passed = bms?.role === "bms" && bmc?.role === "bmc" && bm?.role === "bm";
    record({
      code: "ROLE-01",
      name: "Maintenance Role Mapping (BMS, BMC, BM)",
      passed,
      details: `BMS -> ${bms?.role}, BMC -> ${bmc?.role}, BNM_MANAJER -> ${bm?.role}`,
    });
  }

  // 1.1b Exact production mappings: BNM_MANAGER, BRANCH BUILDING & MAINTENANCE MANAGER -> bm;
  // BRANCH MANAGER -> no automatic mapping!
  {
    const bnmMgr = resolveApprovedSiagaRole("BNM_MANAGER", "MAINTENANCE");
    const bldMtcMgr = resolveApprovedSiagaRole("BRANCH BUILDING & MAINTENANCE MANAGER", "MAINTENANCE");
    const genericBranchMgr = resolveApprovedSiagaRole("BRANCH MANAGER", "MAINTENANCE");
    const passed =
      bnmMgr?.role === "bm" &&
      bldMtcMgr?.role === "bm" &&
      genericBranchMgr?.role === null &&
      genericBranchMgr?.isFlaggedForReview === true;
    record({
      code: "ROLE-01B",
      name: "Production BnM Mapping & Generic Branch Mgr Gate",
      passed,
      details: `BNM_MANAGER -> ${bnmMgr?.role}, BRANCH BUILDING & MAINTENANCE MANAGER -> ${bldMtcMgr?.role}, BRANCH MANAGER -> ${genericBranchMgr?.role} (Flagged: ${genericBranchMgr?.isFlaggedForReview})`,
    });
  }

  // 1.2 Engineering roles: ES -> bes, COORD -> bec, MANAGER -> FLAGGED (NOT bm!)
  {
    const bes = resolveApprovedSiagaRole("ES", "ENGINEERING");
    const bec = resolveApprovedSiagaRole("COORD", "ENGINEERING");
    const engMgr = resolveApprovedSiagaRole("MANAGER", "ENGINEERING");
    const passed =
      bes?.role === "bes" &&
      bec?.role === "bec" &&
      engMgr?.role === null &&
      engMgr?.isFlaggedForReview === true;
    record({
      code: "ROLE-02",
      name: "Engineering Roles (Manager Blocked from BM)",
      passed,
      details: `ES -> ${bes?.role}, COORD -> ${bec?.role}, Eng Mgr -> role: ${engMgr?.role} (Flagged: ${engMgr?.isFlaggedForReview})`,
    });
  }

  // 1.3 Building roles: BBS -> bbs, BBC -> bbc, Branch Manager -> FLAGGED (NOT bm!)
  {
    const bbs = resolveApprovedSiagaRole("BBS", "BUILDING");
    const bbc = resolveApprovedSiagaRole("BBC", "BUILDING");
    const bldMgr = resolveApprovedSiagaRole("Branch Manager", "BUILDING");
    const passed =
      bbs?.role === "bbs" &&
      bbc?.role === "bbc" &&
      bldMgr?.role === null &&
      bldMgr?.isFlaggedForReview === true;
    record({
      code: "ROLE-03",
      name: "Building Roles (Branch Mgr Blocked from BM)",
      passed,
      details: `BBS -> ${bbs?.role}, BBC -> ${bbc?.role}, Bld Mgr -> role: ${bldMgr?.role} (Flagged: ${bldMgr?.isFlaggedForReview})`,
    });
  }

  // 1.4 Head Office roles: Consolidation into Admin business role
  {
    const hoAdmin = resolveApprovedSiagaRole("HO_ADMIN");
    const gmHo = resolveApprovedSiagaRole("GM_HO");
    const smHo = resolveApprovedSiagaRole("SM_HO");
    const adminHo = resolveApprovedSiagaRole("ADMIN_HO");
    const passed =
      hoAdmin?.role === "admin" &&
      gmHo?.role === "admin" &&
      smHo?.role === "admin" &&
      adminHo?.role === "admin" &&
      hoAdmin?.scope === "HO";
    record({
      code: "ROLE-04",
      name: "Head Office Role Consolidation into Admin",
      passed,
      details: `HO_ADMIN, GM_HO, SM_HO, ADMIN_HO -> ${hoAdmin?.role} (Scope: ${hoAdmin?.scope})`,
    });
  }

  // 1.4b Engineering & Building ADMIN_HO Gating (Zero Admin Escalation from Technical Domains)
  {
    const engAdminHo = resolveApprovedSiagaRole("ADMIN_HO", "ENGINEERING");
    const bldAdminHo = resolveApprovedSiagaRole("HO_ADMIN", "BUILDING");
    const passed =
      engAdminHo?.role === null &&
      engAdminHo?.isFlaggedForReview === true &&
      bldAdminHo?.role === null &&
      bldAdminHo?.isFlaggedForReview === true;
    record({
      code: "ROLE-04B",
      name: "Engineering/Building ADMIN_HO Gating",
      passed,
      details: `Eng ADMIN_HO -> role: ${engAdminHo?.role} (Flagged: ${engAdminHo?.isFlaggedForReview}), Bld HO_ADMIN -> role: ${bldAdminHo?.role} (Flagged: ${bldAdminHo?.isFlaggedForReview})`,
    });
  }

  // 1.5 Strict rejection of Administrator escalation
  {
    const superAdmin = resolveApprovedSiagaRole("SUPER_ADMIN");
    const sysAdmin = resolveApprovedSiagaRole("SYSTEM_ADMIN");
    const genericAdmin = resolveApprovedSiagaRole("ADMIN");
    const passed =
      superAdmin?.role === null &&
      sysAdmin?.role === null &&
      genericAdmin?.role === null;
    record({
      code: "ROLE-05",
      name: "Zero Admin Privilege Escalation",
      passed,
      details: "SUPER_ADMIN, SYSTEM_ADMIN, and generic ADMIN are strictly blocked (role is null)",
    });
  }

  // 1.6 Strict gating of unapproved / fallback roles
  {
    const vendor = resolveApprovedSiagaRole("VENDOR_EXTERNAL");
    const requester = resolveApprovedSiagaRole("REQUESTER");
    const toko = resolveApprovedSiagaRole("TIM_TOKO");
    const passed =
      vendor?.role === null &&
      requester?.role === null &&
      toko?.role === null &&
      vendor?.isFlaggedForReview === true;
    record({
      code: "ROLE-06",
      name: "Strict Gating of Unapproved Roles",
      passed,
      details: "VENDOR, REQUESTER, TIM_TOKO flagged for review without unapproved fallback roles",
    });
  }

  // 1.7 Verification of exactly 9 Finalized SIAGA Roles
  {
    const businessRoles = FINALIZED_SIAGA_BUSINESS_ROLES;
    const expectedRoles = ["admin", "bm", "bmc", "bec", "bbc", "bms", "bes", "bbs"];
    const allExpectedPresent = expectedRoles.every((r) => businessRoles.includes(r as any));
    const passed = businessRoles.length === 8 && allExpectedPresent;
    record({
      code: "ROLE-07",
      name: "Finalized 9 Roles Scope Check (8 Biz + 1 SysAdmin)",
      passed,
      details: `8 Business Roles: ${businessRoles.join(", ")} + 1 Technical System Administrator`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 2: Identity Validation, Normalization & Canonical Branch Scoping
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 2: Identity Validation & Branch Normalization ---");

  // 2.1 Rejection of missing all identifiers (no SSO, no NIK, no Email)
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "",
      email: "",
      fullName: "Tanpa Identitas",
      role: "BMS",
      branchName: "Bandung",
    });
    record({
      code: "VAL-01",
      name: "Reject Missing All Identifiers",
      passed: res.user === null && Boolean(res.error?.includes("Identitas tidak valid")),
      details: res.error,
    });
  }

  // 2.2 Building user without NIK (valid email_sat) accepted
  {
    const res = validateAndNormalizeSpartaUser({
      email_sat: "budi.building@sparta.local",
      nama_lengkap: "Budi Building Specialist",
      jabatan: "BBS",
      cabang: "BANDUNG",
      system: "BUILDING",
    });
    const passed =
      res.user !== null &&
      res.user.nik === null &&
      res.user.email === "budi.building@sparta.local" &&
      res.user.businessRole === "bbs" &&
      res.user.branch === "BANDUNG";
    record({
      code: "VAL-02",
      name: "Building User Without NIK Accepted (email_sat)",
      passed,
      details: `Email: ${res.user?.email}, NIK: ${res.user?.nik ?? "null"}, Role: ${res.user?.businessRole}, Branch: ${res.user?.branch}`,
    });
  }

  // 2.3 Rejection of missing Name
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "NIK_12345",
      fullName: "   ",
      role: "BMS",
      branchName: "Bandung",
    });
    record({
      code: "VAL-03",
      name: "Reject Missing Name",
      passed: res.user === null && Boolean(res.error?.includes("Nama lengkap")),
      details: res.error,
    });
  }

  // 2.4 Head Office branch scoping (strictly branch = null, scope = HO)
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "NIK_HO_TEST",
      fullName: "HO Administrator",
      role: "HO_ADMIN",
      branchName: "ANY_BRANCH_IGNORED",
    });
    const passed =
      res.user !== null &&
      res.user.businessRole === "admin" &&
      res.user.scope === "HO" &&
      res.user.branch === null;
    record({
      code: "VAL-04",
      name: "Enforce HO Scope (branch is null, role is admin)",
      passed,
      details: `Role: ${res.user?.businessRole}, Scope: ${res.user?.scope}, Branch: ${res.user?.branch ?? "null"}`,
    });
  }

  // 2.5 Branch canonical normalization & abbreviation aliases (BDG, CKL, SDJ, CLS)
  {
    const res1 = validateAndNormalizeSpartaUser({
      employeeId: "NIK_BR_1",
      fullName: "Staff Bandung",
      role: "BMS",
      branchName: "BDG", // Abbreviation for BANDUNG
    });
    const res2 = validateAndNormalizeSpartaUser({
      employeeId: "NIK_BR_2",
      fullName: "Staff Cikokol",
      role: "BES",
      branchName: "CKL", // Abbreviation for CIKOKOL
    });
    const res3 = validateAndNormalizeSpartaUser({
      employeeId: "NIK_BR_3",
      fullName: "Staff Sidoarjo",
      role: "BBS",
      branchName: "SDJ", // Abbreviation for SIDOARJO
    });
    const passed =
      res1.user?.branch === "BANDUNG" &&
      res2.user?.branch === "CIKOKOL" &&
      res3.user?.branch === "SIDOARJO";
    record({
      code: "VAL-05",
      name: "Branch Normalization & Abbreviation Aliases",
      passed,
      details: `BDG -> ${res1.user?.branch}, CKL -> ${res2.user?.branch}, SDJ -> ${res3.user?.branch}`,
    });
  }

  // 2.6 Rejection of unrecognized legitimate branches (Flagged for Review, No Arbitrary Scope)
  {
    const resUnrecognized = validateAndNormalizeSpartaUser({
      employeeId: "NIK_UNREC_BR",
      fullName: "Staff Outside 28 Branches",
      role: "BMS",
      branchName: "SURABAYA", // Real city, but outside 28 canonical branches
    });
    const passed =
      resUnrecognized.user === null &&
      resUnrecognized.isFlagged === true &&
      Boolean(resUnrecognized.error?.includes("28 cabang"));
    record({
      code: "VAL-06",
      name: "Unrecognized Branches Flagged (No Arbitrary Scope)",
      passed,
      details: `SURABAYA -> user: ${resUnrecognized.user ?? "null"} (Flagged: ${resUnrecognized.isFlagged})`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: Status Normalization & Review Flagging
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 3: Status Normalization & Unknown Status Gating ---");

  // 3.1 Soft-delete status handling
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "NIK_INACTIVE_01",
      fullName: "Resigned Staff",
      role: "BMS",
      branchName: "BANDUNG",
      isActive: false,
    });
    const passed = res.user !== null && res.user.status === "INACTIVE";
    record({
      code: "STAT-01",
      name: "Soft-Deleted Status Mapped to INACTIVE",
      passed,
      details: `isActive: false -> user.status = '${res.user?.status}'`,
    });
  }

  // 3.2 Unknown status flagged for review
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "NIK_UNKNOWN_STAT",
      fullName: "Pending Verification Staff",
      role: "BMS",
      branchName: "BANDUNG",
      status: "PENDING_HR_VERIFICATION",
    });
    const passed =
      res.user !== null &&
      res.user.status === "INACTIVE" &&
      res.user.needsReview === true &&
      Boolean(res.user.reviewReason?.includes("tidak dikenal"));
    record({
      code: "STAT-02",
      name: "Unknown Source Status Flagged for Review",
      passed,
      details: `status = '${res.user?.status}', needsReview: ${res.user?.needsReview}`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Real Data Formats (CSV Ingestion Adapters)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 4: Real Data Formats (Maintenance, Building, Semicolon CSV) ---");

  // 4.1 Maintenance CSV format
  {
    const csvMaintenance = `email,fullName,employeeId,branchCode,role,isActive
andi@sparta.local,Andi Halim,TEST_MTC_01,BDG,BMS,true
budi@sparta.local,Budi Hartono,TEST_MTC_02,CIKOKOL,BMC,true`;

    const parsed = parseSpartaUserCsv(csvMaintenance, "MAINTENANCE");
    const passed =
      parsed.length === 2 &&
      parsed[0].employeeId === "TEST_MTC_01" &&
      parsed[0].role === "BMS" &&
      parsed[1].role === "BMC";
    record({
      code: "CSV-01",
      name: "Maintenance CSV Ingestion Adapter",
      passed,
      details: `Parsed ${parsed.length} rows. Row 0: ${parsed[0].fullName} (${parsed[0].role})`,
    });
  }

  // 4.2 Building CSV format without NIK (email_sat, nama_lengkap, jabatan, cabang)
  {
    const csvBuilding = `email_sat,nama_lengkap,jabatan,cabang
cahyono@sparta.local,Cahyono BBS,BBS,G002
diana@sparta.local,Diana BBC,BBC,CIKOKOL`;

    const parsed = parseSpartaUserCsv(csvBuilding, "BUILDING");
    const passed =
      parsed.length === 2 &&
      parsed[0].email_sat === "cahyono@sparta.local" &&
      parsed[0].role === "BBS" &&
      parsed[1].email_sat === "diana@sparta.local";
    record({
      code: "CSV-02",
      name: "Building CSV Ingestion Adapter (No NIK)",
      passed,
      details: `Parsed ${parsed.length} rows. Row 0: ${parsed[0].fullName} (${parsed[0].email_sat})`,
    });
  }

  // 4.3 Semicolon-delimited Indonesian Excel CSV format
  {
    const csvSemicolon = `email_sat;nama_lengkap;jabatan;cabang;status
eko@sat.co.id;Eko Building;BBS;BANDUNG;ACTIVE
fani@sat.co.id;Fani Building;BBC;CIKOKOL;ACTIVE`;

    const parsed = parseSpartaUserCsv(csvSemicolon, "BUILDING");
    const passed =
      parsed.length === 2 &&
      parsed[0].email_sat === "eko@sat.co.id" &&
      parsed[0].role === "BBS" &&
      parsed[1].fullName === "Fani Building";
    record({
      code: "CSV-03",
      name: "Semicolon Delimited Excel CSV Adapter",
      passed,
      details: `Parsed ${parsed.length} rows using semicolon delimiter. Row 0: ${parsed[0].fullName}`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 5: Production Safety Guard
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 5: Production Safety Guard ---");

  {
    let thrown = false;
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";
      delete process.env.ALLOW_PRODUCTION_USER_SYNC;
      delete process.env.CONFIRM_PRODUCTION_USER_SYNC;

      // In production without ALLOW flag, write execution must throw immediately (forceCheck = true)
      assertProductionUserSyncSafety(false, false, true);
    } catch (err: any) {
      thrown = Boolean(err.message?.includes("PRODUCTION_USER_SYNC_DISABLED"));
    } finally {
      if (originalEnv === undefined) {
        delete (process.env as Record<string, string | undefined>).NODE_ENV;
      } else {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
      }
    }

    record({
      code: "SAFE-01",
      name: "Production Execution Disabled Without Preflight",
      passed: thrown,
      details: "Throws PRODUCTION_USER_SYNC_DISABLED error when production sync is not explicitly approved",
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 6: Dry-Run Mode & Zero Side Effects
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 6: Dry-Run Safety ---");

  const testNik1 = "SYNC_TEST_BMS_BDG_99";
  const testNik2 = "SYNC_TEST_BES_CKL_99";
  const duplicateNik = "SYNC_TEST_DUP_01";
  const buildingEmail = "test.building.dryrun@sparta.local";

  // Cleanup any test leftovers first
  await pool.query(
    `DELETE FROM users WHERE LOWER(TRIM(nik)) IN ($1, $2, $3) OR LOWER(TRIM(email)) = $4`,
    [testNik1.toLowerCase(), testNik2.toLowerCase(), duplicateNik.toLowerCase(), buildingEmail.toLowerCase()]
  );

  const stagingBatch: RawSpartaUserRecord[] = [
    {
      employeeId: testNik1,
      fullName: "Dry Run BMS Bandung",
      email: "dryrun.bms@sparta.local",
      role: "BMS",
      branchName: "BANDUNG",
      system: "MAINTENANCE",
    },
    {
      employeeId: testNik2,
      fullName: "Dry Run BES Cikokol",
      email: "dryrun.bes@sparta.local",
      role: "BES",
      branchName: "CIKOKOL",
      system: "ENGINEERING",
    },
    {
      email_sat: buildingEmail,
      nama_lengkap: "Dry Run BBS Bandung",
      jabatan: "BBS",
      cabang: "BANDUNG",
      system: "BUILDING",
    },
    {
      employeeId: duplicateNik,
      fullName: "Duplicate User First",
      role: "BMS",
      branchName: "BANDUNG",
    },
    {
      employeeId: duplicateNik, // Exact duplicate in batch
      fullName: "Duplicate User Second",
      role: "BMS",
      branchName: "BANDUNG",
    },
    {
      employeeId: "BAD_ESCALATION",
      fullName: "Escalator",
      role: "SUPER_ADMIN",
      branchName: "HEAD OFFICE",
    },
  ];

  {
    const dryRunReport = await executeUserSynchronization(stagingBatch, {
      dryRun: true,
      sourceModule: "ALL",
    });

    // Check DB to guarantee 0 writes occurred
    const checkDb = await pool.query(
      `SELECT count(*)::int as count FROM users WHERE LOWER(TRIM(nik)) IN ($1, $2, $3) OR LOWER(TRIM(email)) = $4`,
      [testNik1.toLowerCase(), testNik2.toLowerCase(), duplicateNik.toLowerCase(), buildingEmail.toLowerCase()]
    );

    const zeroWrites = checkDb.rows[0].count === 0;
    const reportAccurate =
      dryRunReport.dryRun === true &&
      dryRunReport.newCount === 4 && // testNik1, testNik2, buildingEmail, duplicateNik (first)
      dryRunReport.skippedCount === 1 && // duplicate second
      dryRunReport.flaggedForReviewCount === 1; // BAD_ESCALATION

    record({
      code: "DRY-01",
      name: "Dry-Run Produces Zero DB Writes",
      passed: zeroWrites && reportAccurate,
      details: `DB writes: ${checkDb.rows[0].count}, DryRun newCount: ${dryRunReport.newCount}, skipped: ${dryRunReport.skippedCount}, flagged: ${dryRunReport.flaggedForReviewCount}`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 7: Live Execution, Duplicate Prevention & Multi-Role Conflict Handling
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 7: Live Execution, Duplicate Prevention & Multi-Role Preservation ---");

  // 7.1 First Live Run: Inserts new users
  let firstRunReport: any = null;
  {
    firstRunReport = await executeUserSynchronization(stagingBatch, {
      dryRun: false,
      sourceModule: "ALL",
      allowUpdates: true,
    });

    const checkInserted = await pool.query(
      `SELECT id, nik, email, name, business_role, scope, branch, status, source 
       FROM users WHERE LOWER(TRIM(nik)) IN ($1, $2, $3) OR LOWER(TRIM(email)) = $4`,
      [testNik1.toLowerCase(), testNik2.toLowerCase(), duplicateNik.toLowerCase(), buildingEmail.toLowerCase()]
    );

    const insertedCountOk = checkInserted.rows.length === 4;
    const allActive = checkInserted.rows.every((r) => r.status === "ACTIVE");
    const allSpartaSync = checkInserted.rows.every((r) => r.source === "SPARTA_SYNC");

    record({
      code: "EXEC-01",
      name: "Live Execution - Idempotent Insertion",
      passed: insertedCountOk && allActive && allSpartaSync && firstRunReport.newCount === 4,
      details: `Inserted: ${checkInserted.rows.length}/4. Source: SPARTA_SYNC. Status: ACTIVE.`,
    });
  }

  // 7.2 Second Live Run with Identical Data (Strict Idempotency)
  {
    const secondRunReport = await executeUserSynchronization(stagingBatch, {
      dryRun: false,
      sourceModule: "ALL",
      allowUpdates: true,
    });

    const passed =
      secondRunReport.newCount === 0 &&
      secondRunReport.updatedCount === 0 &&
      secondRunReport.unchangedCount === 4 &&
      secondRunReport.skippedCount === 1 &&
      secondRunReport.flaggedForReviewCount === 1;

    record({
      code: "EXEC-02",
      name: "Strict Idempotency on Repeated Run",
      passed,
      details: `New: ${secondRunReport.newCount}, Updated: ${secondRunReport.updatedCount}, Unchanged: ${secondRunReport.unchangedCount}, Skipped: ${secondRunReport.skippedCount}, Flagged: ${secondRunReport.flaggedForReviewCount}`,
    });
  }

  // 7.3 Live Update Detection (Non-destructive update of existing synced user)
  {
    const updatedBatch: RawSpartaUserRecord[] = [
      {
        employeeId: testNik1,
        fullName: "Updated BMS Bandung Name",
        email: "updated.bms@sparta.local",
        role: "BMS",
        branchName: "BANDUNG",
        system: "MAINTENANCE",
      },
    ];

    const updateReport = await executeUserSynchronization(updatedBatch, {
      dryRun: false,
      allowUpdates: true,
    });

    const checkUpdated = await pool.query(
      `SELECT id, nik, name, email FROM users WHERE LOWER(TRIM(nik)) = $1`,
      [testNik1.toLowerCase()]
    );

    const passed =
      updateReport.updatedCount === 1 &&
      checkUpdated.rows[0].name === "Updated BMS Bandung Name" &&
      checkUpdated.rows[0].email === "updated.bms@sparta.local";

    record({
      code: "EXEC-03",
      name: "Non-Destructive Update of Synced User",
      passed,
      details: `Updated name: '${checkUpdated.rows[0]?.name}', email: '${checkUpdated.rows[0]?.email}'`,
    });
  }

  // 7.4 Intra-Batch Multi-Role Detection: Preserves multi-role assignments
  {
    const multiRoleBatch: RawSpartaUserRecord[] = [
      {
        employeeId: "SYNC_MULTI_ROLE_01",
        fullName: "Multi Role Specialist",
        role: "BMS",
        branchName: "BANDUNG",
        system: "MAINTENANCE",
      },
      {
        employeeId: "SYNC_MULTI_ROLE_01",
        fullName: "Multi Role Specialist",
        role: "BES",
        branchName: "BANDUNG",
        system: "ENGINEERING",
      },
    ];

    await pool.query(`DELETE FROM users WHERE LOWER(TRIM(nik)) = 'sync_multi_role_01'`);

    const multiReport = await executeUserSynchronization(multiRoleBatch, {
      dryRun: false,
    });

    const passed =
      multiReport.newCount === 1 &&
      multiReport.flaggedForReviewCount === 1 &&
      multiReport.records.some((r) => r.status === "FLAGGED_FOR_REVIEW" && r.reason?.includes("Multi-role"));

    record({
      code: "EXEC-04",
      name: "Intra-Batch Multi-Role Preservation",
      passed,
      details: `New: ${multiReport.newCount}, Flagged: ${multiReport.flaggedForReviewCount}`,
    });

    await pool.query(`DELETE FROM users WHERE LOWER(TRIM(nik)) = 'sync_multi_role_01'`);
  }

  // 7.5 Database Multi-Role Protection: Active role in DB is NEVER silently overwritten
  {
    // User already exists in SIAGA DB as BMS
    const testDbNik = "sync_existing_db_user_99";
    await pool.query(`DELETE FROM users WHERE LOWER(TRIM(nik)) = $1`, [testDbNik]);

    await pool.query(
      `INSERT INTO users (id, nik, name, email, system_role, business_role, scope, branch, status, source, created_at, updated_at)
       VALUES ('usr_db_protect_01', $1, 'Active BMS User', 'active.bms@sparta.local', 'USER', 'bms', 'BRANCH', 'BANDUNG', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW())`,
      [testDbNik]
    );

    // Import incoming from Engineering with role BES for the SAME user
    const conflictingDbRecord: RawSpartaUserRecord[] = [
      {
        employeeId: testDbNik,
        fullName: "Active BMS User",
        email: "active.bms@sparta.local",
        role: "BES", // Candidate role from Engineering
        branchName: "BANDUNG",
        system: "ENGINEERING",
      },
    ];

    const dbConflictReport = await executeUserSynchronization(conflictingDbRecord, {
      dryRun: false,
      allowUpdates: true,
    });

    // Check DB: business_role MUST still be 'bms', NOT overwritten with 'bes'!
    const checkDbRole = await pool.query(
      `SELECT business_role FROM users WHERE LOWER(TRIM(nik)) = $1`,
      [testDbNik]
    );

    const passed =
      dbConflictReport.flaggedForReviewCount === 1 &&
      dbConflictReport.records[0].status === "FLAGGED_FOR_REVIEW" &&
      checkDbRole.rows[0].business_role === "bms" &&
      Boolean(dbConflictReport.records[0].reason?.includes("Konflik multi-role"));

    record({
      code: "EXEC-05",
      name: "DB Multi-Role Protected from Silent Overwrite",
      passed,
      details: `Existing DB role retained: '${checkDbRole.rows[0]?.business_role}' (BES flagged for review)`,
    });

    await pool.query(`DELETE FROM users WHERE LOWER(TRIM(nik)) = $1`, [testDbNik]);
  }

  // 7.6 Ambiguous Identity Conflict Detection (Mismatched NIK & Email)
  {
    await pool.query(`DELETE FROM users WHERE LOWER(TRIM(nik)) IN ('nik_a_test', 'nik_b_test')`);

    await pool.query(
      `INSERT INTO users (id, nik, name, email, system_role, business_role, scope, branch, status, source, created_at, updated_at)
       VALUES 
       ('usr_ambig_a', 'nik_a_test', 'User A', 'usera@sparta.local', 'USER', 'bms', 'BRANCH', 'BANDUNG', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW()),
       ('usr_ambig_b', 'nik_b_test', 'User B', 'userb@sparta.local', 'USER', 'bes', 'BRANCH', 'BANDUNG', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW())`
    );

    const conflictingRecord: RawSpartaUserRecord[] = [
      {
        employeeId: "nik_a_test",
        email: "userb@sparta.local", // Conflicts with User B!
        fullName: "Conflict Actor",
        role: "BMS",
        branchName: "BANDUNG",
      },
    ];

    const conflictReport = await executeUserSynchronization(conflictingRecord, {
      dryRun: false,
    });

    const passed =
      conflictReport.flaggedForReviewCount === 1 &&
      conflictReport.records[0].status === "FLAGGED_FOR_REVIEW" &&
      Boolean(conflictReport.records[0].reason?.includes("Konflik identitas"));

    record({
      code: "EXEC-06",
      name: "Ambiguous Identity Conflict Flagged (No Merge)",
      passed,
      details: conflictReport.records[0]?.reason,
    });

    await pool.query(`DELETE FROM users WHERE id IN ('usr_ambig_a', 'usr_ambig_b')`);
  }

  // ---------------------------------------------------------------------------
  // SUITE 8: Preservation of Existing Administrator & Protected Accounts
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 8: Protection of System Admin & Existing Workflows ---");

  {
    const adminOverwriteAttempt: RawSpartaUserRecord[] = [
      {
        employeeId: "ADM0001",
        fullName: "Fake Admin Overwrite",
        role: "BMS",
        branchName: "BANDUNG",
      },
    ];

    const report = await executeUserSynchronization(adminOverwriteAttempt, {
      dryRun: false,
      allowUpdates: true,
    });

    const checkAdmin = await pool.query(
      `SELECT id, nik, name, system_role, business_role FROM users WHERE LOWER(TRIM(nik)) = 'adm0001'`
    );

    const admin = checkAdmin.rows[0];
    const passed =
      admin.system_role === "ADMIN" &&
      admin.name === "System Administrator" &&
      report.unchangedCount === 1 &&
      report.records[0].status === "UNCHANGED";

    record({
      code: "PROT-01",
      name: "System Administrator Protection Against Overwrite",
      passed,
      details: `systemRole: '${admin?.system_role}', name: '${admin?.name}', unchanged: ${report.unchangedCount}`,
    });
  }

  // Clean up testing records created during this run
  await pool.query(
    `DELETE FROM users WHERE LOWER(TRIM(nik)) IN ($1, $2, $3) OR LOWER(TRIM(email)) = $4`,
    [testNik1.toLowerCase(), testNik2.toLowerCase(), duplicateNik.toLowerCase(), buildingEmail.toLowerCase()]
  );

  // ---------------------------------------------------------------------------
  // SUITE 9: Synchronization API Endpoint Authorization
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 9: API Route Authorization & Gating ---");

  const syncRoute = await import("../app/api/admin/users/sync/route");
  const loginRoute = await import("../app/api/auth/login/route");

  function extractCookie(res: Response): string | null {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/siaga_session=([^;]+)/);
    return match ? match[1] : null;
  }

  // 9.1 Unauthenticated call -> 401
  {
    const req = new Request("http://localhost/api/admin/users/sync", {
      method: "GET",
    });
    const res = await syncRoute.GET(req);
    record({
      code: "API-01",
      name: "Unauthenticated Request Gated (HTTP 401)",
      passed: res.status === 401,
      details: `Status: ${res.status}`,
    });
  }

  // 9.2 Non-admin user (e.g. BMS) -> 403 Forbidden
  {
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bms", password: "pass123" }),
    });
    const loginRes = await loginRoute.POST(loginReq);
    const cookie = extractCookie(loginRes);

    const req = new Request("http://localhost/api/admin/users/sync", {
      method: "GET",
      headers: { cookie: `siaga_session=${cookie}` },
    });
    const res = await syncRoute.GET(req);
    const passed = res.status === 403;
    record({
      code: "API-02",
      name: "Non-Admin User Gated (HTTP 403 Forbidden)",
      passed,
      details: `Status: ${res.status}`,
    });
  }

  // 9.3 System Admin (ADM0001) -> 200 OK
  {
    const pilotCredsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
    let sysadminPassword = "";
    if (fs.existsSync(pilotCredsPath)) {
      const match = fs.readFileSync(pilotCredsPath, "utf8").match(/PROD_SYSADMIN_PASSWORD=["']?([^"'\r\n]+)["']?/);
      if (match) sysadminPassword = match[1].trim();
    }

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "ADM0001", password: sysadminPassword }),
    });
    const loginRes = await loginRoute.POST(loginReq);
    const cookie = extractCookie(loginRes);

    const req = new Request("http://localhost/api/admin/users/sync", {
      method: "GET",
      headers: { cookie: `siaga_session=${cookie}` },
    });
    const res = await syncRoute.GET(req);
    const json = await res.json();
    const passed = res.status === 200 && Boolean(json.data?.preview);

    record({
      code: "API-03",
      name: "System Admin Authorized Preview (HTTP 200)",
      passed,
      details: `Status: ${res.status}, Staging count: ${json.data?.stagingDatasetCount}, Valid: ${json.data?.preview?.validCount}`,
    });
  }

  await closeDbPool();

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log("\n================================================================================");
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
