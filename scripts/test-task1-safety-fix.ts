import {
  validateSsoModuleAccess,
  mapSsoErrorCodeToRedirect,
  matchSsoIdentityToSiagaUser,
  SsoExchangeUser,
} from "../lib/sso-service";
import {
  executeUserSynchronization,
  resolveApprovedSiagaRole,
} from "../lib/user-sync-service";
import { RawSpartaUserRecord } from "../lib/user-sync-types";
import { UserModel } from "../lib/user-db";

interface TestCheck {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  notes?: string;
}

const checks: TestCheck[] = [];

function check(
  id: string,
  category: string,
  description: string,
  passed: boolean,
  expected?: any,
  actual?: any,
  notes?: string
) {
  checks.push({ id, category, description, passed, expected, actual, notes });
  const status = passed ? "[PASS]" : "[FAIL]";
  console.log(`${status} ${id.padEnd(10)} | ${category.padEnd(24)} | ${description}`);
  if (!passed) {
    console.error(`       Expected: ${JSON.stringify(expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
  }
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — TASK 1: FINAL SAFETY FIX VERIFICATION");
  console.log(" Mode: Targeted Safety & Authentication Gate Verification");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // SUITE 1: SIAGA Module Grant Validation (Valid vs Invalid)
  // ---------------------------------------------------------------------------
  console.log("--- SUITE 1: SIAGA Module Grant Validation ---");

  // 1.1 Token with "siaga" module
  {
    const u1: SsoExchangeUser = { access: ["building", "maintenance", "siaga"] };
    const passed = validateSsoModuleAccess(u1) === true;
    check("GRANT-01", "Module Grant", "Token containing 'siaga' module is authorized", passed, true, passed);
  }

  // 1.2 Token with "SIAGA" uppercase (case insensitivity)
  {
    const u2: SsoExchangeUser = { access: ["SIAGA"] };
    const passed = validateSsoModuleAccess(u2) === true;
    check("GRANT-02", "Module Grant", "Token with uppercase 'SIAGA' is authorized", passed, true, passed);
  }

  // 1.3 Token without "siaga" module
  {
    const u3: SsoExchangeUser = { access: ["building", "maintenance", "energy"] };
    const passed = validateSsoModuleAccess(u3) === false;
    check("GRANT-03", "Module Grant", "Token without 'siaga' is rejected", passed, false, passed);
  }

  // 1.4 Token with empty access
  {
    const u4: SsoExchangeUser = { access: [] };
    const passed = validateSsoModuleAccess(u4) === false;
    check("GRANT-04", "Module Grant", "Token with empty access array is rejected", passed, false, passed);
  }

  // 1.5 Token with null / undefined user
  {
    const passed = validateSsoModuleAccess(null as any) === false;
    check("GRANT-05", "Module Grant", "Null token payload is rejected", passed, false, passed);
  }

  // ---------------------------------------------------------------------------
  // SUITE 2: User Synchronization Safety (status = ACTIVE ONLY for approved)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 2: User Synchronization Safety & Inactive Gating ---");

  // 2.1 PENDING_SSO_GRANT (669 pool): Clean candidate, active in SSO, NO SIAGA grant
  {
    const raw: RawSpartaUserRecord[] = [
      {
        email: "teknisi.bms@sat.co.id",
        nik: "11223301",
        name: "Teknisi BMS Bandung",
        role: "BMS",
        sourceModule: "MAINTENANCE",
        branchName: "BANDUNG",
        ssoMatched: true,
        ssoStatus: "ACTIVE",
        hasSiagaGrant: false, // NO GRANT
      },
    ];

    const report = await executeUserSynchronization(raw, { dryRun: true });
    const rec = report.records[0];
    const passed =
      rec.category === "PENDING_SSO_GRANT" &&
      rec.ssoStatus === "PENDING_SSO_GRANT" &&
      report.pendingSsoGrantCount === 1 &&
      report.categoriesBreakdown!.PENDING_SSO_GRANT === 1 &&
      report.categoriesBreakdown!.ACTIVE === 0;

    check(
      "SYNC-01",
      "Sync Status Gating",
      "Candidate without SIAGA grant is PENDING_SSO_GRANT (not ACTIVE)",
      passed,
      { category: "PENDING_SSO_GRANT", activeCount: 0 },
      { category: rec?.category, activeCount: report.categoriesBreakdown!.ACTIVE }
    );
  }

  // 2.2 UNMATCHED_SSO (123 pool): Active in source module, NOT in SSO
  {
    const raw: RawSpartaUserRecord[] = [
      {
        email: "unmatched.es@sat.co.id",
        nik: "11223302",
        name: "Engineering Staff Unmatched",
        role: "ES",
        sourceModule: "ENGINEERING",
        branchName: "BANDUNG",
        ssoMatched: false,
        ssoStatus: "NOT_IN_SSO",
        hasSiagaGrant: false,
      },
    ];

    const report = await executeUserSynchronization(raw, { dryRun: true });
    const rec = report.records[0];
    const passed =
      rec.category === "UNMATCHED_SSO" &&
      rec.ssoStatus === "UNMATCHED_SSO" &&
      report.unmatchedSsoCount === 1 &&
      report.categoriesBreakdown!.UNMATCHED_SSO === 1;

    check(
      "SYNC-02",
      "Sync Status Gating",
      "Candidate not in SSO is UNMATCHED_SSO",
      passed,
      { category: "UNMATCHED_SSO", unmatchedCount: 1 },
      { category: rec?.category, unmatchedCount: report.unmatchedSsoCount }
    );
  }

  // 2.3 PENDING_REVIEW (31 pool): Conflict / Exception candidate
  {
    const raw: RawSpartaUserRecord[] = [
      {
        email: "conflict.mgr@sat.co.id",
        nik: "11223303",
        name: "Building Manager Disparate",
        role: "Branch Manager", // Building Manager is NOT BM -> FLAGGED
        sourceModule: "BUILDING",
        branchName: "BANDUNG",
        ssoMatched: true,
        ssoStatus: "ACTIVE",
      },
    ];

    const report = await executeUserSynchronization(raw, { dryRun: true });
    const rec = report.records[0];
    const passed =
      rec.category === "PENDING_REVIEW" &&
      rec.ssoStatus === "PENDING_REVIEW" &&
      rec.status === "FLAGGED_FOR_REVIEW" &&
      report.pendingReviewCount === 1;

    check(
      "SYNC-03",
      "Sync Status Gating",
      "Unapproved Building Manager candidate is PENDING_REVIEW",
      passed,
      { category: "PENDING_REVIEW", flagged: true },
      { category: rec?.category, flagged: rec?.status === "FLAGGED_FOR_REVIEW" }
    );
  }

  // 2.4 BLOCKED (50 pool): Soft-deleted candidate in source module
  {
    const raw: RawSpartaUserRecord[] = [
      {
        email: "resigned.user@sat.co.id",
        nik: "11223304",
        name: "Resigned Staff",
        role: "BMS",
        sourceModule: "MAINTENANCE",
        branchName: "BANDUNG",
        isActive: false, // Soft-deleted
      },
    ];

    const report = await executeUserSynchronization(raw, { dryRun: true });
    const rec = report.records[0];
    const passed =
      rec.category === "BLOCKED" &&
      rec.ssoStatus === "BLOCKED" &&
      rec.status === "BLOCKED" &&
      report.blockedCount === 1;

    check(
      "SYNC-04",
      "Sync Status Gating",
      "Soft-deleted candidate is BLOCKED",
      passed,
      { category: "BLOCKED", blockedCount: 1 },
      { category: rec?.category, blockedCount: report.blockedCount }
    );
  }

  // 2.5 ACTIVE candidate: Fully approved with SSO match + SIAGA grant
  {
    const raw: RawSpartaUserRecord[] = [
      {
        email: "authorized.bms@sat.co.id",
        nik: "11223305",
        name: "Authorized BMS",
        role: "BMS",
        sourceModule: "MAINTENANCE",
        branchName: "BANDUNG",
        ssoMatched: true,
        ssoStatus: "ACTIVE",
        hasSiagaGrant: true, // EXPLICIT APPROVED GRANT
      },
    ];

    const report = await executeUserSynchronization(raw, { dryRun: true });
    const rec = report.records[0];
    const passed =
      rec.category === "ACTIVE" &&
      rec.ssoStatus === "ACTIVE" &&
      report.categoriesBreakdown!.ACTIVE === 1;

    check(
      "SYNC-05",
      "Sync Status Gating",
      "Only candidate with approved SIAGA grant is categorized as ACTIVE",
      passed,
      { category: "ACTIVE", activeCount: 1 },
      { category: rec?.category, activeCount: report.categoriesBreakdown!.ACTIVE }
    );
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: Backend Authentication Enforcement (Four Pending/Blocked Categories)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 3: Backend Authentication Rejection for Pending/Blocked ---");

  // 3.1 PENDING_SSO_GRANT rejection mapping
  {
    const redirectCode = mapSsoErrorCodeToRedirect("PENDING_SSO_GRANT");
    check(
      "AUTH-01",
      "SSO Enforcement",
      "PENDING_SSO_GRANT maps to PendingSsoGrant redirect",
      redirectCode === "PendingSsoGrant",
      "PendingSsoGrant",
      redirectCode
    );
  }

  // 3.2 UNMATCHED_SSO rejection mapping
  {
    const redirectCode = mapSsoErrorCodeToRedirect("UNMATCHED_SSO");
    check(
      "AUTH-02",
      "SSO Enforcement",
      "UNMATCHED_SSO maps to UnmatchedSso redirect",
      redirectCode === "UnmatchedSso",
      "UnmatchedSso",
      redirectCode
    );
  }

  // 3.3 PENDING_REVIEW rejection mapping
  {
    const redirectCode = mapSsoErrorCodeToRedirect("PENDING_REVIEW");
    check(
      "AUTH-03",
      "SSO Enforcement",
      "PENDING_REVIEW maps to PendingReview redirect",
      redirectCode === "PendingReview",
      "PendingReview",
      redirectCode
    );
  }

  // 3.4 BLOCKED rejection mapping
  {
    const redirectCode = mapSsoErrorCodeToRedirect("BLOCKED");
    check(
      "AUTH-04",
      "SSO Enforcement",
      "BLOCKED maps to UserBlocked redirect",
      redirectCode === "UserBlocked",
      "UserBlocked",
      redirectCode
    );
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Existing Accounts Non-Regression & Nullable Legacy Behavior
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 4: Existing Accounts Non-Regression & Nullable sso_status ---");

  // 4.1 System Administrator Protection against downgrade / overwrite
  {
    const existingSysAdmin = [
      {
        id: "usr_sysadmin_01",
        email: "sysadmin@sparta-siaga.local",
        nik: "ADM0001",
        name: "System Administrator",
        system_role: "ADMIN",
        business_role: null,
        scope: null,
        branch: null,
        status: "ACTIVE",
        sso_status: null, // Legacy null value
      },
    ];

    const overwriteAttempt: RawSpartaUserRecord[] = [
      {
        email: "sysadmin@sparta-siaga.local",
        nik: "ADM0001",
        name: "Hacker SysAdmin",
        role: "BMS", // Attacker tries demoting or changing role
        sourceModule: "MAINTENANCE",
        branchName: "BANDUNG",
      },
    ];

    const report = await executeUserSynchronization(overwriteAttempt, {
      dryRun: true,
      existingUsers: existingSysAdmin,
    });

    const rec = report.records[0];
    const passed =
      rec.status === "UNCHANGED" &&
      rec.targetRole === null && // sysadmin role preserved
      report.unchangedCount === 1;

    check(
      "EXIST-01",
      "Existing Safety",
      "System Administrator (ADM0001) is protected and UNCHANGED",
      passed,
      { status: "UNCHANGED", unchangedCount: 1 },
      { status: rec?.status, unchangedCount: report.unchangedCount }
    );
  }

  // 4.2 Existing Active UAT User with sso_status: null is NOT downgraded to INACTIVE
  {
    const existingUatUser = [
      {
        id: "usr_bm_bdg_01",
        email: "bm0001@sparta-siaga.local",
        nik: "BM0001",
        name: "BnM Manajer Bandung",
        system_role: "USER",
        business_role: "bm",
        scope: "BRANCH",
        branch: "BANDUNG",
        status: "ACTIVE",
        sso_status: null, // Nullable legacy sso_status
      },
    ];

    const pendingSyncAttempt: RawSpartaUserRecord[] = [
      {
        email: "bm0001@sparta-siaga.local",
        nik: "BM0001",
        name: "BnM Manajer Bandung",
        role: "BNM_MANAJER",
        sourceModule: "MAINTENANCE",
        branchName: "BANDUNG",
        ssoMatched: true,
        ssoStatus: "ACTIVE",
        hasSiagaGrant: false, // Incoming is pending SSO grant
      },
    ];

    const report = await executeUserSynchronization(pendingSyncAttempt, {
      dryRun: true,
      allowUpdates: true,
      existingUsers: existingUatUser,
    });

    const rec = report.records[0];
    // Existing user's active status must be preserved, not downgraded
    const diffStatus = rec.changedFields?.status;
    const passed = diffStatus === undefined; // No status change recorded

    check(
      "EXIST-02",
      "Existing Safety",
      "Existing ACTIVE user is NOT downgraded to INACTIVE by pending sync",
      passed,
      "diff.status is undefined (status preserved)",
      diffStatus === undefined ? "status preserved" : `status changed: ${JSON.stringify(diffStatus)}`
    );
  }

  // 4.3 Multi-role preservation for existing user
  {
    const existingBmcUser = [
      {
        id: "usr_bmc_01",
        email: "bmc.bandung@sparta.local",
        nik: "BMC0001",
        name: "BMC Bandung",
        system_role: "USER",
        business_role: "bmc",
        scope: "BRANCH",
        branch: "BANDUNG",
        status: "ACTIVE",
        sso_status: null,
      },
    ];

    const differentRoleAttempt: RawSpartaUserRecord[] = [
      {
        email: "bmc.bandung@sparta.local",
        nik: "BMC0001",
        name: "BMC Bandung",
        role: "BES", // Engineering specialist role incoming
        sourceModule: "ENGINEERING",
        branchName: "BANDUNG",
        ssoMatched: true,
        ssoStatus: "ACTIVE",
      },
    ];

    const report = await executeUserSynchronization(differentRoleAttempt, {
      dryRun: true,
      allowUpdates: true,
      existingUsers: existingBmcUser,
    });

    const rec = report.records[0];
    const passed =
      rec.status === "FLAGGED_FOR_REVIEW" &&
      rec.category === "PENDING_REVIEW" &&
      rec.targetRole === "bmc" && // Primary active role PRESERVED
      Array.isArray(rec.multiRoles) &&
      rec.multiRoles.length === 2;

    check(
      "EXIST-03",
      "Existing Safety",
      "Existing user role 'bmc' preserved, incoming 'bes' flagged for review",
      passed,
      { targetRole: "bmc", status: "FLAGGED_FOR_REVIEW" },
      { targetRole: rec?.targetRole, status: rec?.status }
    );
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const total = checks.length;
  const passedCount = checks.filter((c) => c.passed).length;
  const failedCount = total - passedCount;

  console.log("\n================================================================================");
  console.log(` TARGETED SAFETY TEST SUMMARY: ${passedCount}/${total} PASSED (${failedCount} failed)`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error("FATAL ERROR in targeted safety test run:", err);
  process.exit(1);
});
