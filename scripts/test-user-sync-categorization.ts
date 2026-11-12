import fs from "node:fs";
import path from "node:path";
import {
  executeUserSynchronization,
  validateAndNormalizeSpartaUser,
  resolveApprovedSiagaRole,
  parseSpartaUserCsv,
  convertReconciledReportToRawRecords,
} from "../lib/user-sync-service";
import {
  FINALIZED_SIAGA_BUSINESS_ROLES,
  RawSpartaUserRecord,
} from "../lib/user-sync-types";

interface TestCheck {
  id: string;
  suite: string;
  description: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  notes?: string;
}

const checks: TestCheck[] = [];

function check(
  id: string,
  suite: string,
  description: string,
  passed: boolean,
  expected?: any,
  actual?: any,
  notes?: string
) {
  checks.push({ id, suite, description, passed, expected, actual, notes });
  const status = passed ? "[PASS]" : "[FAIL]";
  console.log(`${status} ${id.padEnd(10)} | ${suite.padEnd(20)} | ${description}`);
  if (!passed) {
    console.error(`       Expected: ${JSON.stringify(expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
  }
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — TASK 1: USER SYNC CATEGORIZATION & SAFETY TEST SUITE");
  console.log(" Mode: In-Memory / Dry-Run (No Database Mutations)");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // SUITE 1: 9 Finalized SIAGA Roles & Strict Gating
  // ---------------------------------------------------------------------------
  console.log("--- SUITE 1: 9 Finalized SIAGA Roles & Privilege Escalation Gating ---");

  // 1.1 Maintenance BnM vs Generic Branch Manager
  {
    const bnm = resolveApprovedSiagaRole("BNM_MANAGER", "MAINTENANCE");
    const bnmAlt = resolveApprovedSiagaRole("BRANCH BUILDING & MAINTENANCE MANAGER", "MAINTENANCE");
    const genericMgr = resolveApprovedSiagaRole("BRANCH MANAGER", "MAINTENANCE");
    check(
      "ROLE-01",
      "Role Resolution",
      "BNM Manager maps to 'bm', generic 'Branch Manager' is flagged",
      bnm.role === "bm" && bnmAlt.role === "bm" && genericMgr.role === null && genericMgr.isFlaggedForReview === true,
      { bnm: "bm", generic: null, flagged: true },
      { bnm: bnm.role, generic: genericMgr.role, flagged: genericMgr.isFlaggedForReview }
    );
  }

  // 1.2 Engineering & Building Role Gating
  {
    const es = resolveApprovedSiagaRole("ES", "ENGINEERING");
    const coord = resolveApprovedSiagaRole("COORD", "ENGINEERING");
    const engMgr = resolveApprovedSiagaRole("MANAGER", "ENGINEERING");
    const bbs = resolveApprovedSiagaRole("BBS", "BUILDING");
    const bbc = resolveApprovedSiagaRole("BBC", "BUILDING");
    const bldMgr = resolveApprovedSiagaRole("Branch Manager", "BUILDING");

    const passed =
      es.role === "bes" &&
      coord.role === "bec" &&
      engMgr.role === null &&
      engMgr.isFlaggedForReview === true &&
      bbs.role === "bbs" &&
      bbc.role === "bbc" &&
      bldMgr.role === null &&
      bldMgr.isFlaggedForReview === true;

    check(
      "ROLE-02",
      "Role Resolution",
      "Engineering (bes, bec) and Building (bbs, bbc) mapped, managers flagged",
      passed,
      "bes, bec, bbs, bbc mapped; managers flagged",
      `es:${es.role}, coord:${coord.role}, bbs:${bbs.role}, bbc:${bbc.role}, engMgr:${engMgr.role}, bldMgr:${bldMgr.role}`
    );
  }

  // 1.3 Zero Admin Escalation
  {
    const sysAdmin = resolveApprovedSiagaRole("SYSTEM_ADMIN");
    const superAdmin = resolveApprovedSiagaRole("SUPER_ADMIN");
    const bldAdminHo = resolveApprovedSiagaRole("HO_ADMIN", "BUILDING");
    const engAdminHo = resolveApprovedSiagaRole("ADMIN_HO", "ENGINEERING");

    const passed =
      sysAdmin.role === null &&
      superAdmin.role === null &&
      bldAdminHo.role === null &&
      bldAdminHo.isFlaggedForReview === true &&
      engAdminHo.role === null &&
      engAdminHo.isFlaggedForReview === true;

    check(
      "ROLE-03",
      "Privilege Gating",
      "System Administrator & domain Admin_HO blocked from auto-admin grant",
      passed,
      "all admin escalations blocked",
      `sysAdmin:${sysAdmin.role}, bldAdmin:${bldAdminHo.role}, engAdmin:${engAdminHo.role}`
    );
  }

  // ---------------------------------------------------------------------------
  // SUITE 2: Identity, Branch & Multi-Role Logic
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 2: Multi-Branch & Multi-Role Normalization ---");

  // 2.1 Building user without NIK (valid email_sat)
  {
    const res = validateAndNormalizeSpartaUser({
      email_sat: "budi.building@sparta.local",
      nama_lengkap: "Budi Santoso",
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

    check(
      "VAL-01",
      "Identity Validation",
      "Building user without NIK accepted via email_sat",
      passed,
      { email: "budi.building@sparta.local", role: "bbs", branch: "BANDUNG" },
      { email: res.user?.email, role: res.user?.businessRole, branch: res.user?.branch }
    );
  }

  // 2.2 Multi-branch preservation
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "NIK_MULTI_BR",
      fullName: "Agus Multi Branch",
      role: "BES",
      branchName: "BDG",
      canonicalBranches: ["BANDUNG", "CIKOKOL", "SIDOARJO"],
    });

    const passed =
      res.user !== null &&
      res.user.branch === "BANDUNG" &&
      Array.isArray(res.user.secondaryBranches) &&
      res.user.secondaryBranches.length === 2 &&
      res.user.secondaryBranches.includes("CIKOKOL") &&
      res.user.secondaryBranches.includes("SIDOARJO");

    check(
      "VAL-02",
      "Branch Handling",
      "Multi-branch assignments stored in secondaryBranches without duplicates",
      passed,
      { primary: "BANDUNG", secondary: ["CIKOKOL", "SIDOARJO"] },
      { primary: res.user?.branch, secondary: res.user?.secondaryBranches }
    );
  }

  // 2.3 Non-canonical branch flagged for review
  {
    const res = validateAndNormalizeSpartaUser({
      employeeId: "NIK_DEPOT_01",
      fullName: "Staff Depo",
      role: "BES",
      nonCanonicalBranches: ["WH BENGKULU"],
    });

    const passed = res.user === null && res.isFlagged === true;
    check(
      "VAL-03",
      "Branch Handling",
      "Facility-only / non-canonical branch flagged for review",
      passed,
      { user: null, isFlagged: true },
      { user: res.user, isFlagged: res.isFlagged }
    );
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: Full Reconciled Real Dataset Categorization Verification (873 Users)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 3: Full Reconciled Dataset Synchronization (873 Candidates) ---");

  const reportPath = path.resolve(
    "C:/Users/Noval/.gemini/antigravity/brain/28b22b9b-711f-47f0-9f7e-0618f853eb4e/scratch/reconciliation_rerun_full_report.json"
  );

  if (fs.existsSync(reportPath)) {
    const rawReportData = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const rawRecords = convertReconciledReportToRawRecords(rawReportData);

    const syncReport = await executeUserSynchronization(rawRecords, {
      dryRun: true,
      sourceModule: "ALL",
      allowUpdates: true,
      existingUsers: [], // in-memory isolated dry run
    });

    const cats = syncReport.categoriesBreakdown!;
    console.log(`\n  Categorization Summary from Sync Engine:`);
    console.log(`  - Total Scanned:       ${syncReport.totalScanned}`);
    console.log(`  - PENDING_SSO_GRANT:   ${cats.PENDING_SSO_GRANT} (Expected: 669)`);
    console.log(`  - UNMATCHED_SSO:       ${cats.UNMATCHED_SSO} (Expected: 123)`);
    console.log(`  - PENDING_REVIEW:      ${cats.PENDING_REVIEW} (Expected: 31)`);
    console.log(`  - BLOCKED:             ${cats.BLOCKED} (Expected: 50)`);
    console.log(`  - ACTIVE:              ${cats.ACTIVE} (Expected: 0)`);
    console.log(`  - Total Sum:           ${cats.PENDING_SSO_GRANT + cats.UNMATCHED_SSO + cats.PENDING_REVIEW + cats.BLOCKED + cats.ACTIVE} (Expected: 873)\n`);

    const revRecords = syncReport.records.filter((r) => r.category === "PENDING_REVIEW");
    console.log(`  Pending Review records (${revRecords.length}):`);
    revRecords.forEach((r) => console.log(`   - ${r.email || r.identifier} | Role: ${r.targetRole} | Branch: ${r.targetBranch} | Reason: ${r.reason}`));

    check(
      "CAT-01",
      "Dataset Sync",
      "Total scanned matches 873 unique individuals",
      syncReport.totalScanned === 873,
      873,
      syncReport.totalScanned
    );

    check(
      "CAT-02",
      "Dataset Sync",
      "PENDING_SSO_GRANT matches 669 candidates exactly",
      cats.PENDING_SSO_GRANT === 669,
      669,
      cats.PENDING_SSO_GRANT
    );

    check(
      "CAT-03",
      "Dataset Sync",
      "UNMATCHED_SSO matches 123 candidates exactly",
      cats.UNMATCHED_SSO === 123,
      123,
      cats.UNMATCHED_SSO
    );

    check(
      "CAT-04",
      "Dataset Sync",
      "PENDING_REVIEW matches 31 candidates exactly (7 role + 24 active facility)",
      cats.PENDING_REVIEW === 31,
      31,
      cats.PENDING_REVIEW
    );

    check(
      "CAT-05",
      "Dataset Sync",
      "BLOCKED matches 50 soft-deleted users exactly",
      cats.BLOCKED === 50,
      50,
      cats.BLOCKED
    );

    const totalSeg = cats.PENDING_SSO_GRANT + cats.UNMATCHED_SSO + cats.PENDING_REVIEW + cats.BLOCKED + cats.ACTIVE;
    check(
      "CAT-06",
      "Dataset Sync",
      "Sum of all categories equals 873 without double-counting",
      totalSeg === 873,
      873,
      totalSeg
    );
  } else {
    console.warn(`[WARN] Reconciled report not found at ${reportPath}`);
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Multi-Role Preservation without Automatic Escalation
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 4: Multi-Role Preservation & Privilege Lock ---");

  {
    const existingUsers = [
      {
        id: "usr_test_bmc_01",
        email: "teknisi.multi@sparta.local",
        nik: "11223344",
        name: "Teknisi Multi",
        system_role: "USER",
        business_role: "bmc",
        scope: "BRANCH",
        branch: "BANDUNG",
        status: "ACTIVE",
      },
    ];

    const incomingCandidate: RawSpartaUserRecord[] = [
      {
        email: "teknisi.multi@sparta.local",
        nik: "11223344",
        name: "Teknisi Multi",
        role: "BES", // Different role from Engineering!
        sourceModule: "ENGINEERING",
        branchName: "BANDUNG",
        ssoMatched: true,
        ssoStatus: "ACTIVE",
      },
    ];

    const report = await executeUserSynchronization(incomingCandidate, {
      dryRun: true,
      existingUsers,
    });

    const rec = report.records[0];
    const passed =
      rec.status === "FLAGGED_FOR_REVIEW" &&
      rec.category === "PENDING_REVIEW" &&
      rec.targetRole === "bmc" && // Primary active role is PRESERVED!
      Array.isArray(rec.multiRoles) &&
      rec.multiRoles.length === 2 &&
      rec.multiRoles[1].mappedRole === "bes";

    check(
      "MROLE-01",
      "Multi-Role Safety",
      "Existing active role 'bmc' preserved, candidate 'bes' recorded without auto-activation",
      passed,
      { targetRole: "bmc", status: "FLAGGED_FOR_REVIEW", category: "PENDING_REVIEW" },
      { targetRole: rec?.targetRole, status: rec?.status, category: rec?.category }
    );
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const total = checks.length;
  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = total - passedCount;

  console.log("\n================================================================================");
  console.log(` TEST SUMMARY: ${passedCount}/${total} PASSED (${failedCount} failed)`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in test run:", err);
  process.exit(1);
});
