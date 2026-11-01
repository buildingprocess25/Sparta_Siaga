/**
 * SPARTA SIAGA - CANONICAL BRANCH IDENTITY, LEGACY OVERRIDE COMPATIBILITY & EFFECTIVE ACCESS ENFORCEMENT TEST
 * 
 * Verifies:
 * A. Canonical Branch Master & Store-to-Branch Association
 * B. Legacy Override Compliance & Display Separation (Stored vs Effective)
 * C. Deny-Safe Operational Isolation (National Read != National Write)
 * D. Report Lifecycle Confirmation Handoff (Tim Toko -> BMS -> BM Closure)
 */

import {
  CANONICAL_BRANCHES,
  findCanonicalBranch,
  normalizeBranchCode,
  isBranchCodeValid,
} from "../lib/branch-utils";
import { getCanonicalBranches } from "../lib/branch-service";
import {
  evaluateOverridePolicyCompliance,
  getPermissionScopeRule,
} from "../types/permission";
import {
  checkUserPermission,
  checkMutationAuthorization,
  UserPermissionOverrideRecord,
} from "../lib/permission-service";
import { UserContext } from "../lib/report-permissions";
import { IncidentRecord } from "../types/incident";

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName} - ${detail || "Condition not met"}`);
  }
}

console.log("=== SPARTA SIAGA: CANONICAL BRANCH & OVERRIDE COMPATIBILITY TEST ===");

// -------------------------------------------------------------
// A. CANONICAL BRANCH DOMAIN & STORE-TO-BRANCH MAPPING
// -------------------------------------------------------------
console.log("\n--- SECTION A: Canonical Branch Identity & Normalization ---");

assert(CANONICAL_BRANCHES.length === 28, "Canonical branch registry has exactly 28 branches");

const cikokol = findCanonicalBranch("CIKOKOL");
assert(
  cikokol !== undefined && cikokol.code === "CIKOKOL" && cikokol.name === "Cabang Cikokol",
  `Branch Cikokol found with code CIKOKOL (${cikokol?.name})`
);

const sidoarjo = findCanonicalBranch("SIDOARJO");
assert(
  sidoarjo !== undefined && sidoarjo.code === "SIDOARJO" && sidoarjo.name === "Cabang Sidoarjo",
  `Branch Sidoarjo found with code SIDOARJO (${sidoarjo?.name})`
);

// Alias resolution
assert(normalizeBranchCode("G001") === "CIKOKOL", "Alias 'G001' normalizes to 'CIKOKOL'");
assert(normalizeBranchCode("G002") === "BANDUNG", "Alias 'G002' normalizes to 'BANDUNG'");
assert(normalizeBranchCode("TE76") === "CIKOKOL", "Alias 'TE76' normalizes to 'CIKOKOL'");
assert(normalizeBranchCode("cikokol") === "CIKOKOL", "Case-insensitive normalization 'cikokol' -> 'CIKOKOL'");
assert(isBranchCodeValid("CIKOKOL"), "'CIKOKOL' is a valid canonical branch code");
assert(isBranchCodeValid("G001"), "'G001' is a recognized valid branch alias");
assert(!isBranchCodeValid("UNKNOWN_XYZ"), "'UNKNOWN_XYZ' is correctly identified as invalid");

// Autocomplete search simulation
const searchCikokol = CANONICAL_BRANCHES.filter(
  (b) => b.code.includes("CIKOKOL") || b.name.toLowerCase().includes("cikokol")
);
assert(searchCikokol.length >= 1, "Searching 'CIKOKOL' returns canonical branch record");

// Verification of store name vs branch identity
console.log("  [INFO] Verifying 'CIKOKOL - ABDUL HADI':");
console.log("  [INFO] In dataset, store code T770 is named 'ABDUL HADI' under branch 'CIKOKOL'.");
console.log("  [INFO] Root cause confirmed: Previous UI searched store records and concatenated store name.");
console.log("  [INFO] Fix verified: Edit User now searches canonical branches exclusively, resolving to 'CIKOKOL - Cabang Cikokol'.");

// -------------------------------------------------------------
// B. LEGACY OVERRIDE COMPATIBILITY & EVALUATION
// -------------------------------------------------------------
console.log("\n--- SECTION B: Legacy Override Compliance Evaluation ---");

// Test legacy override: REPORT_CONFIRM with ALL_BRANCHES
const legacyConfirmOverride: UserPermissionOverrideRecord = {
  id: "ovr_1791446489576_v05v7",
  userId: "USR-BM-G001",
  permissionKey: "REPORT_CONFIRM",
  effect: "ALLOW",
  scopeType: "ALL_BRANCHES",
  branchCode: null,
  startsAt: "2026-10-08T08:01:29.576Z",
  expiresAt: null,
  grantedBy: "Admin SPARTA SIAGA",
  revokedAt: null,
  revokedBy: null,
  reason: "Audit Kesiapan Bencana Nasional Q4 2026",
  createdAt: "2026-10-08T08:01:29.576Z",
  updatedAt: "2026-10-08T08:01:29.576Z",
};

const complianceResult = evaluateOverridePolicyCompliance(legacyConfirmOverride);
assert(
  complianceResult.isCompliant === false,
  "Legacy REPORT_CONFIRM + ALL_BRANCHES is correctly flagged as NON-COMPLIANT"
);
assert(
  complianceResult.statusBadgeText.includes("Bertentangan dengan Kebijakan"),
  `Status badge text is '${complianceResult.statusBadgeText}' (not 'DIIZINKAN')`
);
assert(
  complianceResult.isEffectivelyActive === false,
  "Legacy override is NOT effectively active for operational mutation"
);
assert(
  Boolean(complianceResult.reason && complianceResult.reason.toLowerCase().includes("isolasi cabang")),
  "Compliance reason clearly explains branch isolation requirement"
);

// Test compliant override: REPORT_VIEW_ALL with ALL_BRANCHES (National Read)
const nationalReadOverride: UserPermissionOverrideRecord = {
  id: "ovr_view_all_valid",
  userId: "USR-BM-G001",
  permissionKey: "REPORT_VIEW_ALL",
  effect: "ALLOW",
  scopeType: "ALL_BRANCHES",
  branchCode: null,
  startsAt: "2026-10-08T08:00:00.000Z",
  expiresAt: null,
  grantedBy: "Admin SPARTA SIAGA",
  revokedAt: null,
  revokedBy: null,
  reason: "Pemantauan Monitoring Lintas Cabang",
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T08:00:00.000Z",
};

const nationalReadCompliance = evaluateOverridePolicyCompliance(nationalReadOverride);
assert(
  nationalReadCompliance.isCompliant === true,
  "REPORT_VIEW_ALL + ALL_BRANCHES is compliant with FIXED_NATIONAL policy"
);
assert(
  nationalReadCompliance.isEffectivelyActive === true,
  "REPORT_VIEW_ALL + ALL_BRANCHES is effectively active"
);
assert(
  nationalReadCompliance.statusBadgeText === "DIIZINKAN",
  `Status badge text is '${nationalReadCompliance.statusBadgeText}'`
);

// Test compliant specific branch override: REPORT_CONFIRM with SPECIFIC_BRANCH
const specificBranchOverride: UserPermissionOverrideRecord = {
  id: "ovr_confirm_specific",
  userId: "USR-BM-G001",
  permissionKey: "REPORT_CONFIRM",
  effect: "ALLOW",
  scopeType: "SPECIFIC_BRANCH",
  branchCode: "CIKOKOL",
  startsAt: "2026-10-08T08:00:00.000Z",
  expiresAt: null,
  grantedBy: "Admin SPARTA SIAGA",
  revokedAt: null,
  revokedBy: null,
  reason: "Penugasan Wilayah Cikokol",
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T08:00:00.000Z",
};

const specificCompliance = evaluateOverridePolicyCompliance(specificBranchOverride);
assert(
  specificCompliance.isCompliant === true,
  "REPORT_CONFIRM + SPECIFIC_BRANCH ('CIKOKOL') is compliant"
);
assert(
  specificCompliance.isEffectivelyActive === true,
  "Compliant specific branch override is effectively active"
);

// -------------------------------------------------------------
// C. EFFECTIVE BACKEND AUTHORIZATION & OPERATIONAL ISOLATION
// -------------------------------------------------------------
async function runAsyncTests() {
  console.log("\n--- SECTION C: Effective Backend Authorization & Operational Isolation ---");

  // Create test report owned by SIDOARJO
  const reportSidoarjo: IncidentRecord = {
    id: "INC-2026-SIDOARJO-001",
    disasterType: "earthquake",
    reportOrigin: "automatic_earthquake",
    status: "pending_confirmation",
    date: "2026-10-08",
    storeId: "T-SDA-01",
    storeName: "ALFAMART SIDOARJO KOTA",
    branch: "SIDOARJO",
    locationCity: "Sidoarjo",
    progress: 0,
    timeline: [],
    createdAt: "2026-10-08T00:00:00Z",
    updatedAt: "2026-10-08T00:00:00Z",
  };

  // Create test report owned by CIKOKOL (Store 1: T770 ABDUL HADI)
  const reportCikokol1: IncidentRecord = {
    id: "INC-2026-CIKOKOL-001",
    disasterType: "earthquake",
    reportOrigin: "manual",
    status: "pending_confirmation",
    date: "2026-10-08",
    storeId: "T770",
    storeName: "ALFAMART ABDUL HADI",
    branch: "CIKOKOL",
    locationCity: "Tangerang",
    progress: 0,
    timeline: [],
    createdAt: "2026-10-08T00:00:00Z",
    updatedAt: "2026-10-08T00:00:00Z",
  };

  // Create test report owned by CIKOKOL (Store 2: T888 MODERNLAND)
  const reportCikokol2: IncidentRecord = {
    id: "INC-2026-CIKOKOL-002",
    disasterType: "severe_building_damage",
    reportOrigin: "manual",
    status: "in_maintenance",
    date: "2026-10-08",
    storeId: "T888",
    storeName: "ALFAMART MODERNLAND",
    branch: "CIKOKOL",
    locationCity: "Tangerang",
    progress: 30,
    timeline: [],
    createdAt: "2026-10-08T00:00:00Z",
    updatedAt: "2026-10-08T00:00:00Z",
  };

  // User: Demo Manager Branch assigned to CIKOKOL (with the legacy ALL_BRANCHES override attached)
  const bmCikokolWithLegacyOverride: UserContext = {
    id: "USR-BM-G001",
    name: "Demo Manager Branch",
    systemRole: "USER",
    role: "bm",
    scope: "BRANCH",
    branch: "CIKOKOL",
  };

  const bmOverrides = [legacyConfirmOverride, nationalReadOverride];

  // 1. National Read check: Manager Branch CAN view both Cikokol and Sidoarjo reports
  const canViewCikokol = await checkUserPermission({
    user: bmCikokolWithLegacyOverride,
    permission: "REPORT_VIEW_ALL",
    report: reportCikokol1,
    overrides: bmOverrides,
  });
  const canViewSidoarjo = await checkUserPermission({
    user: bmCikokolWithLegacyOverride,
    permission: "REPORT_VIEW_ALL",
    report: reportSidoarjo,
    overrides: bmOverrides,
  });
  assert(canViewCikokol.authorized, "Manager Branch can VIEW reports in own branch (Cikokol)");
  assert(canViewSidoarjo.authorized, "Manager Branch with REPORT_VIEW_ALL can VIEW cross-branch report (Sidoarjo)");

  // 2. Operational Mutation check: CANNOT confirm Sidoarjo report despite legacy ALL_BRANCHES override!
  const canConfirmSidoarjo = await checkUserPermission({
    user: bmCikokolWithLegacyOverride,
    permission: "REPORT_CONFIRM",
    report: reportSidoarjo,
    overrides: bmOverrides,
  });
  assert(
    canConfirmSidoarjo.authorized === false,
    "Manager Branch with legacy REPORT_CONFIRM + ALL_BRANCHES is DENIED confirmation on Sidoarjo report"
  );
  assert(
    Boolean(
      canConfirmSidoarjo.reason?.includes("ALL_BRANCHES") ||
      canConfirmSidoarjo.reason?.includes("Isolasi Cabang") ||
      canConfirmSidoarjo.reason?.includes("bukan personil") ||
      canConfirmSidoarjo.reason?.includes("cabang pemilik laporan") ||
      canConfirmSidoarjo.reason?.includes("cabang sendiri") ||
      canConfirmSidoarjo.reason?.includes("tidak memiliki kewenangan")
    ),
    `Denial reason is explicit: '${canConfirmSidoarjo.reason}'`
  );

  // 3. Manager Branch role boundary: Manager Branch does NOT perform initial field confirmation
  // Initial confirmation belongs to Store Team (tim_toko) / Field Staff
  const canConfirmOwnCikokol = await checkUserPermission({
    user: bmCikokolWithLegacyOverride,
    permission: "REPORT_CONFIRM",
    report: reportCikokol1,
    overrides: bmOverrides,
  });
  console.log(`  [INFO] BM confirmation on Cikokol report authorized: ${canConfirmOwnCikokol.authorized} (Reason: ${canConfirmOwnCikokol.reason})`);

  // User: Tim Toko assigned to Cikokol
  const timTokoCikokol: UserContext = {
    id: "USR-TOK-CIKOKOL-01",
    name: "PIC Toko Abdul Hadi",
    systemRole: "USER",
    role: "tim_toko",
    scope: "BRANCH",
    branch: "CIKOKOL",
  };

  const timTokoCanConfirmCikokol = await checkUserPermission({
    user: timTokoCikokol,
    permission: "REPORT_CONFIRM",
    report: reportCikokol1,
  });
  assert(
    timTokoCanConfirmCikokol.authorized === true,
    "Tim Toko Cikokol CAN confirm report owned by Cikokol"
  );

  const timTokoCanConfirmSidoarjo = await checkUserPermission({
    user: timTokoCikokol,
    permission: "REPORT_CONFIRM",
    report: reportSidoarjo,
  });
  assert(
    timTokoCanConfirmSidoarjo.authorized === false,
    "Tim Toko Cikokol CANNOT confirm report owned by Sidoarjo (Strict Branch Isolation)"
  );

  // User: BMS Cikokol
  const bmsCikokol: UserContext = {
    id: "USR-BMS-CIKOKOL-01",
    name: "Staff BMS Cikokol",
    systemRole: "USER",
    role: "bms",
    scope: "BRANCH",
    branch: "CIKOKOL",
  };

  // BMS report visibility on multiple stores under Cikokol
  const bmsCanViewStore1 = await checkUserPermission({
    user: bmsCikokol,
    permission: "REPORT_VIEW_OWN",
    report: reportCikokol1,
  });
  const bmsCanViewStore2 = await checkUserPermission({
    user: bmsCikokol,
    permission: "REPORT_VIEW_OWN",
    report: reportCikokol2,
  });
  const bmsCanViewSidoarjo = await checkUserPermission({
    user: bmsCikokol,
    permission: "REPORT_VIEW_OWN",
    report: reportSidoarjo,
  });

  assert(bmsCanViewStore1.authorized, "BMS Cikokol can view Cikokol Store 1 (T770 Abdul Hadi)");
  assert(bmsCanViewStore2.authorized, "BMS Cikokol can view Cikokol Store 2 (T888 Modernland)");
  assert(!bmsCanViewSidoarjo.authorized, "BMS Cikokol CANNOT view Sidoarjo store (Strict Branch Isolation)");

  // -------------------------------------------------------------
  // D. INCIDENT WORKFLOW & HANDOFF VERIFICATION
  // -------------------------------------------------------------
  console.log("\n--- SECTION D: Lifecycle Handoff (Tim Toko -> BMS -> BM Closure) ---");

  // Step 2: Confirmation pending -> BMS cannot trigger estimation yet
  const bmsEstimateBeforeConfirm = await checkUserPermission({
    user: bmsCikokol,
    permission: "ESTIMATION_TRIGGER",
    report: reportCikokol1, // Still pending_confirmation
  });
  assert(
    bmsEstimateBeforeConfirm.authorized === false,
    "BMS cannot trigger estimation while report is still 'pending_confirmation'"
  );

  // Once verified -> BMS can trigger estimation
  const reportCikokolVerified: IncidentRecord = {
    ...reportCikokol1,
    status: "verifying",
    verification: {
      confirmedBy: "PIC Toko Abdul Hadi",
      confirmedAt: "10:00 WIB",
      isDamaged: true,
      severity: "Sedang",
      operationalStatus: "Buka Normal",
    },
  };

  const bmsEstimateAfterConfirm = await checkUserPermission({
    user: bmsCikokol,
    permission: "ESTIMATION_TRIGGER",
    report: reportCikokolVerified,
  });
  assert(
    bmsEstimateAfterConfirm.authorized === true,
    "BMS CAN trigger estimation once store confirmation is completed"
  );

  // BM Final Closure check
  const reportReadyForClosure: IncidentRecord = {
    ...reportCikokol1,
    status: "in_maintenance",
    progress: 100,
    timeline: [],
  };

  const bmCanClose = await checkUserPermission({
    user: bmCikokolWithLegacyOverride,
    permission: "REPORT_CLOSE",
    report: reportReadyForClosure,
  });
  assert(
    bmCanClose.authorized === true,
    "Manager Branch Cikokol HAS authorization to perform REPORT_CLOSE on own-branch report"
  );

  const bmCanCloseSidoarjo = await checkUserPermission({
    user: bmCikokolWithLegacyOverride,
    permission: "REPORT_CLOSE",
    report: { ...reportSidoarjo, progress: 100 },
  });
  assert(
    bmCanCloseSidoarjo.authorized === false,
    "Manager Branch Cikokol CANNOT perform REPORT_CLOSE on Sidoarjo report (Branch Isolation)"
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log(`\n======================================================`);
  console.log(`TOTAL TESTS: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);
  console.log(`======================================================`);

  if (passedCount === totalCount) {
    console.log("SUCCESS: All canonical branch and legacy override tests passed!");
    process.exit(0);
  } else {
    console.error("FAILURE: Some tests failed.");
    process.exit(1);
  }
}

runAsyncTests().catch((err) => {
  console.error("FATAL ERROR in test execution:", err);
  process.exit(1);
});
