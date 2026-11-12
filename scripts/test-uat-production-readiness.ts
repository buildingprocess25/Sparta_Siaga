import { getDbPool } from "../lib/db";
import {
  isProductionEnvironment,
  isUatSimulationAllowed,
  assertSimulationAllowed,
} from "../lib/environment-policy";
import { checkUserPermission } from "../lib/permission-service";
import {
  canCreateManagementInstruction,
  canApproveAsBm,
  canInspectReport,
  UserContext,
} from "../lib/report-permissions";
import { POST as triggerPost } from "../app/api/simulation/earthquake/trigger/route";
import { POST as resetPost } from "../app/api/simulation/reset/route";
import { GET as statusGet } from "../app/api/simulation/status/route";
import { POST as loginPost } from "../app/api/auth/login/route";

async function runTestSuite() {
  console.log("==================================================================");
  console.log("SPARTA SIAGA — TEST SUITE: UAT & PRODUCTION READINESS VERIFICATION");
  console.log("==================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? " - " + detail : ""}`);
      failed++;
    }
  }

  const pool = getDbPool();

  try {
    // -------------------------------------------------------------------------
    // TEST SECTION 1: Baseline User Table Verification
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 1: Staging User Count & Isolation Integrity ---");
    const userCountRes = await pool.query("SELECT COUNT(*) AS total FROM users WHERE source != 'DEVELOPMENT'");
    const totalUsers = parseInt(userCountRes.rows[0].total, 10);
    assert(
      totalUsers === 701,
      `User count integrity: exactly 701 staging users (32 baseline + 669 candidates)`,
      `Got ${totalUsers}`
    );

    const ssoStatusBreakdown = await pool.query(
      `SELECT COALESCE(sso_status, 'NULL') as status, COUNT(*) as count 
       FROM users GROUP BY sso_status ORDER BY count DESC`
    );
    console.log("   SSO status breakdown in staging:");
    ssoStatusBreakdown.rows.forEach((r) => {
      console.log(`   - ${r.status}: ${r.count}`);
    });
    const pendingSso = ssoStatusBreakdown.rows.find((r) => r.status === "PENDING_SSO_GRANT");
    assert(
      pendingSso && parseInt(pendingSso.count, 10) === 669,
      "Task 1 synced candidates preserved: exactly 669 PENDING_SSO_GRANT users"
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 2: Environment Policy & Fail-Closed Guards
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 2: Fail-Closed Production Protection & Environment Policy ---");
    // Verify current staging environment allows simulation
    assert(
      !isProductionEnvironment(),
      "Staging environment correctly detected as NON-production"
    );
    assert(
      isUatSimulationAllowed(),
      "UAT simulation permitted in isolated staging environment"
    );

    // Test Fail-Closed assertion under simulated production
    const origAppEnv = process.env.APP_ENV;
    const origDbUrl = process.env.DATABASE_URL;

    try {
      process.env.APP_ENV = "production";
      let productionBlocked = false;
      try {
        assertSimulationAllowed();
      } catch (err: any) {
        if (err.message.includes("SIMULATION_FORBIDDEN_IN_PRODUCTION")) {
          productionBlocked = true;
        }
      }
      assert(
        productionBlocked,
        "assertSimulationAllowed() throws SIMULATION_FORBIDDEN_IN_PRODUCTION when APP_ENV=production"
      );

      // Test trigger endpoint rejects under production
      const req = new Request("http://localhost:3004/api/simulation/earthquake/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetKey: "citarum" }),
      });
      const res = await triggerPost(req);
      const resBody = await res.json();
      assert(
        res.status === 403 && resBody.code === "SIMULATION_FORBIDDEN_IN_PRODUCTION",
        "POST /api/simulation/earthquake/trigger returns HTTP 403 in simulated production"
      );

      // Test reset endpoint rejects under production
      const resetReq = new Request("http://localhost:3004/api/simulation/reset", {
        method: "POST",
      });
      const resetRes = await resetPost(resetReq);
      const resetBody = await resetRes.json();
      assert(
        resetRes.status === 403 && resetBody.code === "SIMULATION_FORBIDDEN_IN_PRODUCTION",
        "POST /api/simulation/reset returns HTTP 403 in simulated production"
      );

      // Test status endpoint returns allowed: false in production
      const statusRes = await statusGet();
      const statusBody = await statusRes.json();
      assert(
        statusBody.allowed === false,
        "GET /api/simulation/status reports allowed: false in simulated production"
      );

      // Test UAT persona login rejection in production
      const uatLoginReq = new Request("http://localhost:3004/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: "bms.bandung@sparta-siaga.local",
          password: "password123",
        }),
      });
      const uatLoginRes = await loginPost(uatLoginReq);
      const uatLoginBody = await uatLoginRes.json();
      assert(
        uatLoginRes.status === 403 && uatLoginBody.code === "UAT_LOGIN_FORBIDDEN_IN_PRODUCTION",
        "POST /api/auth/login blocks UAT personas with 403 in simulated production"
      );
    } finally {
      process.env.APP_ENV = origAppEnv;
      process.env.DATABASE_URL = origDbUrl;
    }

    // Verify UAT persona cannot bypass SSO in UAT/staging environment
    const uatSsoBypassReq = new Request("http://localhost:3004/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: "bms.bandung@sparta-siaga.local",
        password: "anypassword",
      }),
    });
    const uatSsoBypassRes = await loginPost(uatSsoBypassReq);
    const uatSsoBypassBody = await uatSsoBypassRes.json();
    assert(
      uatSsoBypassRes.status === 403 && uatSsoBypassBody.code === "SSO_LOGIN_REQUIRED",
      "POST /api/auth/login enforces SSO authentication for UAT personas (SSO bypass blocked)"
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 3: Real Calculation Engine & UAT Earthquake Trigger
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 3: Earthquake Simulation Engine Execution ---");
    const secret = process.env.SPARTA_INTERNAL_WORKER_SECRET || "33b0cafeff83be461c54bb5c9bbd2a65ac7a17a8c21c239ae8792aca05dc7230415aa5e602b54d45622bd7f3672c26db";
    const testSimEventId = "SIM-EVENT-DEDUP-01";

    // Trigger targeted simulation event
    const triggerReq = new Request("http://localhost:3004/api/simulation/earthquake/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-worker-secret": secret,
      },
      body: JSON.stringify({
        eventId: testSimEventId,
        latitude: -6.9175,
        longitude: 107.6191,
        magnitude: 4.6,
        depthKm: 25,
        title: "Gempa Bumi UAT Uji Deduplikasi",
      }),
    });
    const triggerRes = await triggerPost(triggerReq);
    const triggerData = await triggerRes.json();
    assert(
      triggerRes.status === 200 && triggerData.success === true,
      "Earthquake simulation trigger executes successfully with 200 OK",
      JSON.stringify(triggerData)
    );
    assert(
      triggerData.affectedReportsCount >= 0,
      `Calculated affected reports count: ${triggerData.affectedReportsCount}`
    );
    assert(
      triggerData.incidentId && triggerData.incidentId.startsWith("SIM-"),
      `Generated simulation event ID prefix compliant: ${triggerData.incidentId}`
    );

    // Verify incident was saved in DB
    const incCheck = await pool.query(
      "SELECT * FROM incidents WHERE canonical_event_id = $1 OR earthquake_event_id = $1 LIMIT 1",
      [testSimEventId]
    );
    assert(incCheck.rows.length >= 1, "Simulation incident stored in database");

    // -------------------------------------------------------------------------
    // TEST SECTION 4: First Report Wins & Deduplication Verification
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 4: First Report Wins & Idempotent Deduplication ---");
    // Re-trigger the same earthquake simulation: it should deduplicate and not recreate duplicate reports
    const retriggerReq = new Request("http://localhost:3004/api/simulation/earthquake/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-worker-secret": secret,
      },
      body: JSON.stringify({
        eventId: testSimEventId,
        latitude: -6.9175,
        longitude: 107.6191,
        magnitude: 4.6,
        depthKm: 25,
        title: "Gempa Bumi UAT Uji Deduplikasi",
      }),
    });
    const retriggerRes = await triggerPost(retriggerReq);
    const retriggerData = await retriggerRes.json();
    assert(
      retriggerRes.status === 200 && retriggerData.success === true,
      "Duplicate earthquake trigger handles idempotently without error"
    );
    assert(
      retriggerData.affectedReportsCount === 0,
      "First Report Wins: Re-triggering the same event resulted in 0 duplicate reports created"
    );

    // Check that we didn't double the incident rows for the same event and store
    const sampleStoreId = incCheck.rows[0]?.store_id || incCheck.rows[0]?.location_code_snapshot || 'B081';
    const dupCheck = await pool.query(
      "SELECT COUNT(*) as count FROM incidents WHERE (canonical_event_id = $1 OR earthquake_event_id = $1) AND (store_id = $2 OR location_code_snapshot = $2)",
      [testSimEventId, sampleStoreId]
    );
    assert(
      parseInt(dupCheck.rows[0].count, 10) === 1,
      "First Report Wins: No duplicate incident record created for the same event and store"
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 5: HO Admin Permissions & RBAC Enforcement
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 5: HO Admin Permissions & Role Boundaries ---");
    const hoAdminUser: UserContext = {
      id: "test-ho-admin",
      name: "HO Admin",
      role: "admin",
      systemRole: "USER",
      scope: "HO",
      branch: "HEAD OFFICE",
    };

    const dummyReport: any = {
      id: "LAP-TEST-01",
      branch: "BANDUNG",
      status: "pending_bm_approval",
      tkpType: "toko",
      verification: {
        bmApproval: {
          decision: "pending",
        },
      },
    };

    const mgmtPerm = await checkUserPermission({
      user: hoAdminUser,
      permission: "MANAGEMENT_INSTRUCTION_CREATE",
    });
    assert(
      mgmtPerm.authorized === true,
      "HO Admin (businessRole: admin, scope: HO) has MANAGEMENT_INSTRUCTION_CREATE permission via checkUserPermission"
    );

    assert(
      canCreateManagementInstruction(hoAdminUser),
      "canCreateManagementInstruction(hoAdminUser) returns true"
    );

    const viewAllPerm = await checkUserPermission({
      user: hoAdminUser,
      permission: "REPORT_VIEW_ALL",
    });
    assert(
      viewAllPerm.authorized === true,
      "HO Admin has national incident monitoring permission (REPORT_VIEW_ALL)"
    );

    const submitPerm = await checkUserPermission({
      user: hoAdminUser,
      permission: "COMPLETION_SUBMIT",
      targetBranch: "BANDUNG",
    });
    assert(
      submitPerm.authorized === false,
      "HO Admin CANNOT submit operational inspections/completion (strictly branch role)"
    );

    assert(
      !canInspectReport(hoAdminUser, dummyReport),
      "canInspectReport returns false for HO Admin"
    );

    const approvePerm = await checkUserPermission({
      user: hoAdminUser,
      permission: "REPORT_BM_APPROVAL",
      targetBranch: "BANDUNG",
    });
    assert(
      approvePerm.authorized === false,
      "HO Admin CANNOT verify/approve branch incidents (reserved for branch BM/BnM)"
    );

    assert(
      !canApproveAsBm(hoAdminUser, dummyReport),
      "canApproveAsBm returns false for HO Admin"
    );

    const closePerm = await checkUserPermission({
      user: hoAdminUser,
      permission: "REPORT_CLOSE",
      targetBranch: "BANDUNG",
    });
    assert(
      closePerm.authorized === false,
      "HO Admin CANNOT perform Case Close (strictly forbidden)"
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 6: 9 UAT Personas & Multi-Branch Verification
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 6: 9 UAT Roles & Multi-Branch Availability ---");
    const uatUsers = await pool.query(
      `SELECT business_role, system_role, branch, email, sso_status 
       FROM users 
       WHERE email LIKE '%@sparta-siaga.local' OR sso_status = 'UAT_PERSONA'
       ORDER BY business_role, branch`
    );
    console.log(`   Found ${uatUsers.rows.length} UAT test persona accounts.`);

    const sysAdmins = uatUsers.rows.filter((r) => r.system_role === "ADMIN");
    assert(sysAdmins.length > 0, "UAT System Administrator persona exists and is configured");

    const rolesFound = new Set(uatUsers.rows.map((r) => r.business_role).filter(Boolean));
    const expectedBusinessRoles = ["ho_admin", "bm", "bmc", "bec", "bbc", "bms", "bes", "bbs"];
    expectedBusinessRoles.forEach((role) => {
      assert(rolesFound.has(role), `UAT persona role '${role}' exists and is configured`);
    });

    const branchesFound = new Set(uatUsers.rows.map((r) => r.branch).filter(Boolean));
    assert(branchesFound.has("BANDUNG"), "UAT personas configured for BANDUNG branch");
    assert(branchesFound.has("CIKOKOL"), "UAT personas configured for CIKOKOL branch");

    // -------------------------------------------------------------------------
    // TEST SECTION 7: UAT Scenario Reset & User Safety
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 7: Scenario Reset & Data Isolation ---");
    const resetReq = new Request("http://localhost:3004/api/simulation/reset", {
      method: "POST",
      headers: {
        "x-internal-worker-secret": secret,
      },
    });
    const resetRes = await resetPost(resetReq);
    const resetData = await resetRes.json();
    assert(
      resetRes.status === 200 && resetData.success === true,
      "Scenario reset completes successfully",
      JSON.stringify(resetData)
    );

    // Verify staging user count remained 701 after reset
    const userCountAfterReset = await pool.query("SELECT COUNT(*) AS total FROM users WHERE source != 'DEVELOPMENT'");
    const totalUsersAfter = parseInt(userCountAfterReset.rows[0].total, 10);
    assert(
      totalUsersAfter === 701,
      `User count preserved after reset: exactly 701 staging users`,
      `Expected 701, got ${totalUsersAfter}`
    );

    // Verify simulation baseline restored
    const baselineCheck = await pool.query(
      "SELECT id, branch, status FROM incidents WHERE id IN ('INC-UAT1-TOKO-001', 'INC-UAT2-DC-001', 'INC-UAT2-EQ-001')"
    );
    assert(
      baselineCheck.rows.length === 3,
      "Baseline simulation incidents (INC-UAT1-TOKO-001, INC-UAT2-DC-001 & INC-UAT2-EQ-001) successfully reseeded"
    );

    // -------------------------------------------------------------------------
    // TEST SECTION 8: Final Summary
    // -------------------------------------------------------------------------
    console.log("\n==================================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Test execution encountered an error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTestSuite();
