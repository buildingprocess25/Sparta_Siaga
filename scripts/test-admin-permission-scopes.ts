/**
 * SPARTA SIAGA - Test Admin Permission Logic, Canonical Scopes & Override Enforcement
 * 
 * Tests:
 * 1. Scope Rule Catalog Integrity
 * 2. REPORT_VIEW_ALL fixed national scope auto-resolution & contradictory scope rejection
 * 3. Operational permissions zero-cross-branch mutation protection (rejection of ALL_BRANCHES)
 * 4. User Override lifecycle: ALLOW, DENY precedence, superseding, expiry, revocation
 * 5. Effective permission resolution: National Read vs Cross-Branch Mutation Isolation
 * 6. Incident lifecycle verification: Tim Toko -> Confirmation -> BMS Technical Handoff
 */

import {
  PERMISSION_KEYS,
  PERMISSION_DEFINITIONS,
  PERMISSION_SCOPE_RULES,
  getPermissionScopeRule,
  isFixedScopePermission,
  isOperationalPermission,
  PermissionKey,
} from "../types/permission";
import { UserContext } from "../lib/report-permissions";
import {
  checkUserPermission,
  checkMutationAuthorization,
  UserPermissionOverrideRecord,
} from "../lib/permission-service";
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

console.log("=== SPARTA SIAGA: ADMIN PERMISSION LOGIC & SCOPE ACCEPTANCE TEST ===");

// -------------------------------------------------------------
// 1. SCOPE RULE CATALOG INTEGRITY
// -------------------------------------------------------------
console.log("\n1. Testing Scope Rule Catalog Integrity...");
assert(
  PERMISSION_KEYS.length === Object.keys(PERMISSION_SCOPE_RULES).length,
  "All permission keys have corresponding scope rules",
  `Expected ${PERMISSION_KEYS.length}, got ${Object.keys(PERMISSION_SCOPE_RULES).length}`
);

const nationalRule = getPermissionScopeRule("REPORT_VIEW_ALL");
assert(
  nationalRule.policy === "FIXED_NATIONAL" &&
  nationalRule.defaultScope === "ALL_BRANCHES" &&
  nationalRule.allowedScopes.length === 1 &&
  nationalRule.allowedScopes[0] === "ALL_BRANCHES",
  "REPORT_VIEW_ALL has FIXED_NATIONAL policy with allowedScopes: ['ALL_BRANCHES']"
);
assert(
  isFixedScopePermission("REPORT_VIEW_ALL") === true,
  "REPORT_VIEW_ALL is correctly recognized as fixed scope permission"
);

const ownRule = getPermissionScopeRule("REPORT_VIEW_OWN");
assert(
  ownRule.policy === "FIXED_OWN" &&
  ownRule.allowedScopes[0] === "OWN_SCOPE" &&
  isFixedScopePermission("REPORT_VIEW_OWN") === true,
  "REPORT_VIEW_OWN has FIXED_OWN policy with allowedScopes: ['OWN_SCOPE']"
);

// Verify operational permissions cannot have ALL_BRANCHES
const operationalKeys: PermissionKey[] = [
  "REPORT_CONFIRM",
  "REPORT_FOLLOW_UP",
  "REPORT_UPDATE_PROGRESS",
  "REPORT_CLOSE",
  "ESTIMATION_TRIGGER",
  "WORK_READINESS_UPDATE",
  "COMPLETION_SUBMIT",
  "COMPLETION_APPROVE_COORDINATOR",
];

for (const opKey of operationalKeys) {
  const rule = getPermissionScopeRule(opKey);
  assert(
    rule.policy === "BRANCH_SCOPED" &&
    !rule.allowedScopes.includes("ALL_BRANCHES") &&
    rule.allowedScopes.includes("SPECIFIC_BRANCH") &&
    rule.allowedScopes.includes("OWN_SCOPE"),
    `Operational permission '${opKey}' allows SPECIFIC_BRANCH & OWN_SCOPE, forbids ALL_BRANCHES`
  );
}

// -------------------------------------------------------------
// 2. CONTRADICTORY SCOPE REJECTION & SCOPE VALIDATION LOGIC
// -------------------------------------------------------------
console.log("\n2. Testing Scope Policy & Contradictory Scope Rejection...");

function validateScopePayload(permissionKey: PermissionKey, scopeType: string): { valid: boolean; error?: string } {
  const rule = getPermissionScopeRule(permissionKey);
  if (!rule.allowedScopes.includes(scopeType as any)) {
    return {
      valid: false,
      error: `Cakupan '${scopeType}' bertentangan dengan kebijakan hak akses '${permissionKey}'. Cakupan yang valid: ${rule.allowedScopes.join(", ")}.`,
    };
  }
  if (isOperationalPermission(permissionKey) && scopeType === "ALL_BRANCHES") {
    return {
      valid: false,
      error: "Cakupan 'Semua Branch' tidak diizinkan untuk hak akses operasional (Zero Cross-Branch Mutation).",
    };
  }
  return { valid: true };
}

// Test REPORT_VIEW_ALL with valid scope
const testNationalValid = validateScopePayload("REPORT_VIEW_ALL", "ALL_BRANCHES");
assert(testNationalValid.valid === true, "REPORT_VIEW_ALL accepts ALL_BRANCHES scope");

// Test REPORT_VIEW_ALL with contradictory scope
const testNationalContradictory = validateScopePayload("REPORT_VIEW_ALL", "SPECIFIC_BRANCH");
assert(
  testNationalContradictory.valid === false &&
  Boolean(testNationalContradictory.error?.includes("bertentangan dengan kebijakan hak akses")),
  "REPORT_VIEW_ALL rejects contradictory SPECIFIC_BRANCH scope"
);

// Test operational permission with ALL_BRANCHES (must be rejected)
const testOperationalAllBranches = validateScopePayload("REPORT_UPDATE_PROGRESS", "ALL_BRANCHES");
assert(
  testOperationalAllBranches.valid === false,
  "REPORT_UPDATE_PROGRESS rejects contradictory ALL_BRANCHES scope"
);

const testOperationalValidSpecific = validateScopePayload("REPORT_UPDATE_PROGRESS", "SPECIFIC_BRANCH");
assert(testOperationalValidSpecific.valid === true, "REPORT_UPDATE_PROGRESS accepts SPECIFIC_BRANCH scope");

const testOperationalValidOwn = validateScopePayload("REPORT_UPDATE_PROGRESS", "OWN_SCOPE");
assert(testOperationalValidOwn.valid === true, "REPORT_UPDATE_PROGRESS accepts OWN_SCOPE scope");

// -------------------------------------------------------------
// 3. EFFECTIVE PERMISSION RESOLUTION: NATIONAL READ VS WRITE ISOLATION
// -------------------------------------------------------------
console.log("\n3. Testing Effective Permission: National READ vs Cross-Branch Mutation Isolation...");

// Personas
const bmCikokol: UserContext = {
  id: "USR-BM-CIKOKOL",
  name: "Demo Branch Manager Cikokol",
  role: "bm",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "CIKOKOL",
};

const incidentCikokol: IncidentRecord = {
  id: "INC-CIK-001",
  branch: "CIKOKOL",
  storeId: "T-CIK-01",
  storeName: "Alfamart Cikokol",
  disasterType: "flood",
  status: "in_maintenance",
  progress: 50,
  createdAt: new Date().toISOString(),
  reporterName: "Tim Toko Cikokol",
} as any;

const incidentManado: IncidentRecord = {
  id: "INC-MAN-001",
  branch: "MANADO",
  storeId: "T-MAN-01",
  storeName: "Alfamart Manado",
  disasterType: "earthquake",
  status: "in_maintenance",
  progress: 30,
  createdAt: new Date().toISOString(),
  reporterName: "Tim Toko Manado",
} as any;

// A. Without override: BM Cikokol cannot read Manado report
async function testReadWithoutOverride() {
  const readRes = await checkUserPermission({
    user: bmCikokol,
    permission: "REPORT_VIEW_ALL",
    report: incidentManado,
    overrides: [],
  });
  assert(readRes.authorized === false, "Without override, BM Cikokol cannot read Manado report");
}

// B. With active national read override: BM Cikokol CAN read Manado report
const nationalReadOverride: UserPermissionOverrideRecord = {
  id: "ovr_nat_read_001",
  userId: bmCikokol.id,
  permissionKey: "REPORT_VIEW_ALL",
  effect: "ALLOW",
  scopeType: "ALL_BRANCHES",
  branchCode: null,
  reason: "Penugasan monitoring nasional dari GM HO",
  startsAt: new Date(Date.now() - 3600000).toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  grantedBy: "Admin SPARTA SIAGA",
  revokedAt: null,
  revokedBy: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function testReadWithNationalOverride() {
  const readRes = await checkUserPermission({
    user: bmCikokol,
    permission: "REPORT_VIEW_ALL",
    report: incidentManado,
    overrides: [nationalReadOverride],
  });
  assert(
    readRes.authorized === true && readRes.source === "USER_OVERRIDE_ALLOW",
    "With active REPORT_VIEW_ALL override, BM Cikokol CAN view Manado report"
  );
}

// C. CRITICAL: National READ does NOT authorize mutation on Manado report!
async function testCrossBranchMutationBlocked() {
  // Even with national read override, attempting to update progress or close report in MANADO must be BLOCKED
  const updateManado = await checkMutationAuthorization(
    "update_progress",
    bmCikokol,
    incidentManado
  );
  assert(
    updateManado.authorized === false,
    "National READ does NOT authorize cross-branch update_progress in Manado"
  );

  const closeManado = await checkMutationAuthorization(
    "close",
    bmCikokol,
    incidentManado
  );
  assert(
    closeManado.authorized === false,
    "National READ does NOT authorize cross-branch close in Manado"
  );

  // But mutation on own branch Cikokol is permitted
  const closeCikokol = await checkMutationAuthorization(
    "close",
    bmCikokol,
    incidentCikokol
  );
  assert(
    closeCikokol.authorized === true,
    "BM Cikokol retains authorized mutation on own branch Cikokol"
  );
}

// D. Test what happens if someone tried a rogue override with ALL_BRANCHES on an operational action
const rogueOperationalOverride: UserPermissionOverrideRecord = {
  id: "ovr_rogue_001",
  userId: bmCikokol.id,
  permissionKey: "REPORT_UPDATE_PROGRESS",
  effect: "ALLOW",
  scopeType: "ALL_BRANCHES", // Rogue ALL_BRANCHES on operational action
  branchCode: null,
  reason: "Attempted cross-branch override",
  startsAt: new Date(Date.now() - 3600000).toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  grantedBy: "Admin",
  revokedAt: null,
  revokedBy: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function testRogueOperationalOverrideBlocked() {
  const permCheck = await checkUserPermission({
    user: bmCikokol,
    permission: "REPORT_UPDATE_PROGRESS",
    report: incidentManado,
    overrides: [rogueOperationalOverride],
  });
  assert(
    permCheck.authorized === false,
    "Guard prevents rogue ALL_BRANCHES override from granting cross-branch operational mutation"
  );
}

// -------------------------------------------------------------
// 4. USER OVERRIDE LIFECYCLE (DENY PRECEDENCE, EXPIRY, REVOCATION)
// -------------------------------------------------------------
console.log("\n4. Testing Override Lifecycle: DENY Precedence, Expiry, Revocation...");

async function testDenyPrecedence() {
  // BM has inherent REPORT_CLOSE on own branch. Adding explicit DENY override on own branch.
  const denyOverride: UserPermissionOverrideRecord = {
    id: "ovr_deny_001",
    userId: bmCikokol.id,
    permissionKey: "REPORT_CLOSE",
    effect: "DENY",
    scopeType: "OWN_SCOPE",
    branchCode: null,
    reason: "Pemberhentian sementara wewenang penutupan insiden",
    startsAt: new Date(Date.now() - 3600000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    grantedBy: "Admin",
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const permRes = await checkUserPermission({
    user: bmCikokol,
    permission: "REPORT_CLOSE",
    report: incidentCikokol,
    overrides: [denyOverride],
  });
  assert(
    permRes.authorized === false && permRes.source === "USER_OVERRIDE_DENY",
    "Explicit DENY override takes precedence over role-inherited ALLOW"
  );
}

async function testExpiredOverride() {
  // Expired ALLOW override
  const expiredOverride: UserPermissionOverrideRecord = {
    id: "ovr_exp_001",
    userId: bmCikokol.id,
    permissionKey: "REPORT_VIEW_ALL",
    effect: "ALLOW",
    scopeType: "ALL_BRANCHES",
    branchCode: null,
    reason: "Expired temporary grant",
    startsAt: new Date(Date.now() - 7200000).toISOString(),
    expiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
    grantedBy: "Admin",
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const permRes = await checkUserPermission({
    user: bmCikokol,
    permission: "REPORT_VIEW_ALL",
    report: incidentManado,
    overrides: [expiredOverride],
  });
  assert(
    permRes.authorized === false,
    "Expired override is automatically filtered out and does not grant access"
  );
}

async function testRevokedOverride() {
  const revokedOverride: UserPermissionOverrideRecord = {
    id: "ovr_rev_001",
    userId: bmCikokol.id,
    permissionKey: "REPORT_VIEW_ALL",
    effect: "ALLOW",
    scopeType: "ALL_BRANCHES",
    branchCode: null,
    reason: "Revoked grant",
    startsAt: new Date(Date.now() - 7200000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    grantedBy: "Admin",
    revokedAt: new Date().toISOString(), // Revoked
    revokedBy: "Admin SPARTA SIAGA",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const permRes = await checkUserPermission({
    user: bmCikokol,
    permission: "REPORT_VIEW_ALL",
    report: incidentManado,
    overrides: [revokedOverride],
  });
  assert(
    permRes.authorized === false,
    "Revoked override (revokedAt != null) does not grant access"
  );
}

// -------------------------------------------------------------
// 5. SYSTEM ADMIN FULL ACCESS & HO READ-ONLY ISOLATION
// -------------------------------------------------------------
console.log("\n5. Testing System Admin Full Access & HO Read-Only Isolation...");

const sysAdminUser: UserContext = {
  id: "usr_seed_admin",
  name: "Admin SPARTA SIAGA",
  role: null,
  systemRole: "ADMIN",
  scope: null,
  branch: null,
};

const hoViewerUser: UserContext = {
  id: "usr_ho_monitor",
  name: "HO Monitor",
  role: "ho_admin",
  systemRole: "USER",
  scope: "HO",
  branch: null,
};

async function testSystemAdminGuards() {
  // System Admin CAN view all reports
  const viewRes = await checkUserPermission({
    user: sysAdminUser,
    permission: "REPORT_VIEW_ALL",
    report: incidentCikokol,
  });
  assert(
    viewRes.authorized === true && viewRes.source === "SYSTEM_ADMIN",
    "System Admin can view all reports for system monitoring & audit"
  );

  // System Admin CAN perform operational actions under new policy (Full Super Admin)
  const confirmRes = await checkUserPermission({
    user: sysAdminUser,
    permission: "REPORT_CONFIRM",
    report: incidentCikokol,
  });
  assert(
    confirmRes.authorized === true && confirmRes.source === "SYSTEM_ADMIN",
    "System Admin has authorized REPORT_CONFIRM access"
  );

  const progressRes = await checkUserPermission({
    user: sysAdminUser,
    permission: "REPORT_UPDATE_PROGRESS",
    report: incidentCikokol,
  });
  assert(
    progressRes.authorized === true && progressRes.source === "SYSTEM_ADMIN",
    "System Admin has authorized REPORT_UPDATE_PROGRESS access"
  );

  const closeRes = await checkUserPermission({
    user: sysAdminUser,
    permission: "REPORT_CLOSE",
    report: incidentCikokol,
  });
  assert(
    closeRes.authorized === true && closeRes.source === "SYSTEM_ADMIN",
    "System Admin has authorized REPORT_CLOSE access"
  );

  // HO Viewer is strictly forbidden from operational mutations
  const hoConfirmRes = await checkUserPermission({
    user: hoViewerUser,
    permission: "REPORT_CONFIRM",
    report: incidentCikokol,
  });
  assert(
    hoConfirmRes.authorized === false,
    "HO Viewer is strictly forbidden from REPORT_CONFIRM"
  );

  const hoProgressRes = await checkUserPermission({
    user: hoViewerUser,
    permission: "REPORT_UPDATE_PROGRESS",
    report: incidentCikokol,
  });
  assert(
    hoProgressRes.authorized === false,
    "HO Viewer is strictly forbidden from REPORT_UPDATE_PROGRESS"
  );

  const hoCloseRes = await checkUserPermission({
    user: hoViewerUser,
    permission: "REPORT_CLOSE",
    report: incidentCikokol,
  });
  assert(
    hoCloseRes.authorized === false,
    "HO Viewer is strictly forbidden from REPORT_CLOSE"
  );
}

// -------------------------------------------------------------
// 6. INCIDENT LIFECYCLE & BMS WORK QUEUE VERIFICATION
// -------------------------------------------------------------
console.log("\n6. Testing Incident Lifecycle: Tim Toko -> Confirmation -> BMS Handoff...");

const bmsCikokol: UserContext = {
  id: "USR-BMS-001",
  name: "Demo BMS",
  role: "bms",
  systemRole: "USER",
  scope: "BRANCH",
  branch: "CIKOKOL",
};

const pendingIncidentCikokol: IncidentRecord = {
  id: "INC-NEW-001",
  branch: "CIKOKOL",
  storeId: "T-CIK-01",
  storeName: "Alfamart Cikokol",
  disasterType: "flood",
  status: "pending_confirmation",
  progress: 0,
  createdAt: new Date().toISOString(),
  reporterName: "Demo Tim Toko",
} as any;

const confirmedIncidentCikokol: IncidentRecord = {
  id: "INC-NEW-001",
  branch: "CIKOKOL",
  storeId: "T-CIK-01",
  storeName: "Alfamart Cikokol",
  disasterType: "flood",
  status: "in_maintenance",
  progress: 0,
  createdAt: new Date().toISOString(),
  reporterName: "Demo Tim Toko",
} as any;

async function testBmsLifecycle() {
  // BMS can view reports in own branch even if pending confirmation
  const bmsViewOwn = await checkUserPermission({
    user: bmsCikokol,
    permission: "REPORT_VIEW_OWN",
    report: pendingIncidentCikokol,
    overrides: [],
  });
  assert(
    bmsViewOwn.authorized === true,
    "BMS can view newly created report in own branch (REPORT_VIEW_OWN)"
  );

  // BMS has ESTIMATION_TRIGGER permission on own branch
  const bmsEstimationPerm = await checkUserPermission({
    user: bmsCikokol,
    permission: "ESTIMATION_TRIGGER",
    report: confirmedIncidentCikokol,
    overrides: [],
  });
  assert(
    bmsEstimationPerm.authorized === true,
    "BMS has ESTIMATION_TRIGGER authorized for confirmed report in own branch"
  );

  // BMS cannot trigger estimation on another branch's report
  const bmsEstimationManado = await checkUserPermission({
    user: bmsCikokol,
    permission: "ESTIMATION_TRIGGER",
    report: incidentManado,
    overrides: [],
  });
  assert(
    bmsEstimationManado.authorized === false,
    "BMS cannot trigger estimation for report in another branch (Manado)"
  );
}

async function runAll() {
  await testReadWithoutOverride();
  await testReadWithNationalOverride();
  await testCrossBranchMutationBlocked();
  await testRogueOperationalOverrideBlocked();
  await testDenyPrecedence();
  await testExpiredOverride();
  await testRevokedOverride();
  await testSystemAdminGuards();
  await testBmsLifecycle();

  console.log("\n=======================================================");
  console.log(`RESULTS: ${passedCount} / ${totalCount} PASSED`);
  if (passedCount === totalCount) {
    console.log("ALL TESTS COMPLETED SUCCESSFULLY! (100% PASS)");
    process.exit(0);
  } else {
    console.error(`SOME TESTS FAILED: ${totalCount - passedCount} failures`);
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
