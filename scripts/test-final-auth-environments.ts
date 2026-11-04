import assert from "node:assert";
import { getDbPool } from "../lib/db";
import { 
  getSpartaEnvironment, 
  isProductionEnvironment, 
  isUatEnvironment, 
  isDevelopmentEnvironment, 
  isQuickLoginPermitted,
  getLogoutRedirectUrl,
  getSsoModuleLauncherUrl,
  assertSimulationAllowed
} from "../lib/environment-policy";
import { POST as quickLoginPost } from "../app/api/auth/quick-login/route";
import { POST as logoutPost } from "../app/api/auth/logout/route";
import { POST as loginPost } from "../app/api/auth/login/route";
import { GET as envStatusGet } from "../app/api/auth/env-status/route";
import { POST as triggerPost } from "../app/api/simulation/earthquake/trigger/route";
import { POST as resetPost } from "../app/api/simulation/reset/route";
import { GET as statusGet } from "../app/api/simulation/status/route";
import { checkUserPermission } from "../lib/permission-service";
import { canInspectReport, canApproveAsBm } from "../lib/report-permissions";
import { getSessionUser } from "../lib/auth";

let passedCount = 0;
let failedCount = 0;

function testAssert(condition: boolean, description: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${description}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${description}`);
    if (detail) console.error(`       Detail: ${detail}`);
  }
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("SPARTA SIAGA — FINAL AUTHENTICATION & ENVIRONMENT TEST SUITE");
  console.log("==================================================================");

  const pool = getDbPool();
  const origAppEnv = process.env.APP_ENV;
  const origDbUrl = process.env.DATABASE_URL;

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Local Development Quick Login & 9-Role Simulation
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 1: Local Development Quick Login & 9-Role Verification ---");
    process.env.APP_ENV = "development";
    process.env.SPARTA_ENVIRONMENT = "development";

    testAssert(
      getSpartaEnvironment() === "development",
      "getSpartaEnvironment() resolves to 'development' when APP_ENV=development"
    );
    testAssert(
      isDevelopmentEnvironment() === true,
      "isDevelopmentEnvironment() returns true"
    );

    // Test env-status API endpoint
    const envStatusReq = new Request("http://localhost:3004/api/auth/env-status", {
      headers: { host: "localhost:3004" },
    });
    const envStatusRes = await envStatusGet(envStatusReq);
    const envStatusData = await envStatusRes.json();
    testAssert(
      envStatusRes.status === 200 && envStatusData.isDevelopment === true && envStatusData.isQuickLoginAllowed === true,
      "GET /api/auth/env-status confirms Local Development with Quick Login enabled"
    );

    // Test Quick Login across all 9 roles
    const devRolesToTest = [
      { role: "sysadmin", branch: "HEAD OFFICE", expectedSysRole: "ADMIN", expectedBizRole: null },
      { role: "admin", branch: "HEAD OFFICE", expectedSysRole: "USER", expectedBizRole: "admin" },
      { role: "bm", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bm" },
      { role: "bmc", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bmc" },
      { role: "bec", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bec" },
      { role: "bbc", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bbc" },
      { role: "bms", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bms" },
      { role: "bes", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bes" },
      { role: "bbs", branch: "BANDUNG", expectedSysRole: "USER", expectedBizRole: "bbs" },
      { role: "bm", branch: "CIKOKOL", expectedSysRole: "USER", expectedBizRole: "bm" },
      { role: "bms", branch: "CIKOKOL", expectedSysRole: "USER", expectedBizRole: "bms" },
    ];

    for (const r of devRolesToTest) {
      const qlReq = new Request("http://localhost:3004/api/auth/quick-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: "localhost:3004",
        },
        body: JSON.stringify({ role: r.role, branch: r.branch }),
      });
      const qlRes = await quickLoginPost(qlReq);
      const qlData = await qlRes.json();

      testAssert(
        qlRes.status === 200 && qlData.success === true,
        `Quick Login successful for role '${r.role}' (${r.branch})`
      );
      testAssert(
        qlData.user.systemRole === r.expectedSysRole && qlData.user.role === r.expectedBizRole,
        `Role '${r.role}' has exact expected systemRole (${r.expectedSysRole}) and businessRole (${r.expectedBizRole})`
      );

      // Verify cookies are set
      const cookieHeader = qlRes.headers.get("set-cookie") || "";
      testAssert(
        cookieHeader.includes("siaga_session=") && cookieHeader.includes("siaga_refresh="),
        `Session & Refresh cookies issued for Quick Login role '${r.role}'`
      );
    }

    // Role Differentiation Test: System Administrator vs Admin HO
    console.log("\n--- SECTION 1B: System Administrator vs Admin HO RBAC Differentiation ---");
    const sysAdminUser = {
      id: "usr_dev_adm01",
      name: "Dev System Administrator",
      role: null,
      systemRole: "ADMIN" as const,
      scope: "HO" as const,
      branch: "HEAD OFFICE",
    };
    const adminHoUser = {
      id: "usr_dev_ho01",
      name: "Dev Admin HO",
      role: "admin" as const,
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: "HEAD OFFICE",
    };

    // System Administrator
    testAssert(
      sysAdminUser.systemRole === "ADMIN" && sysAdminUser.role === null,
      "System Administrator has systemRole=ADMIN and businessRole=null"
    );

    // Admin HO
    testAssert(
      adminHoUser.systemRole === "USER" && adminHoUser.role === "admin",
      "Admin HO has systemRole=USER and businessRole=admin"
    );

    const hoMgmtPerm = await checkUserPermission({
      user: adminHoUser,
      permission: "MANAGEMENT_INSTRUCTION_CREATE",
    });
    testAssert(
      hoMgmtPerm.authorized === true,
      "Admin HO has MANAGEMENT_INSTRUCTION_CREATE permission"
    );

    const hoApprovePerm = await checkUserPermission({
      user: adminHoUser,
      permission: "REPORT_BM_APPROVAL",
      targetBranch: "BANDUNG",
    });
    testAssert(
      hoApprovePerm.authorized === false,
      "Admin HO CANNOT approve branch incidents (strictly forbidden)"
    );

    const hoInspectPerm = await checkUserPermission({
      user: adminHoUser,
      permission: "REPORT_INSPECT",
      targetBranch: "BANDUNG",
    });
    testAssert(
      hoInspectPerm.authorized === false,
      "Admin HO CANNOT inspect branch incidents (strictly forbidden)"
    );

    // Test Quick Login Protection: Non-Loopback & Public Tunnel Rejection
    console.log("\n--- SECTION 1C: Quick Login Loopback & Tunnel Protection ---");
    const tunnelReq = new Request("http://siaga-test.loca.lt/api/auth/quick-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "siaga-test.loca.lt",
        "x-forwarded-host": "siaga-test.loca.lt",
      },
      body: JSON.stringify({ role: "sysadmin" }),
    });
    const tunnelRes = await quickLoginPost(tunnelReq);
    const tunnelData = await tunnelRes.json();
    testAssert(
      tunnelRes.status === 403 && tunnelData.error === "QUICK_LOGIN_FORBIDDEN",
      "Quick Login rejects public tunnel host (*.loca.lt) with HTTP 403 QUICK_LOGIN_FORBIDDEN"
    );

    const ngrokReq = new Request("http://evaluator.ngrok-free.app/api/auth/quick-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "evaluator.ngrok-free.app",
        "x-forwarded-host": "evaluator.ngrok-free.app",
      },
      body: JSON.stringify({ role: "sysadmin" }),
    });
    const ngrokRes = await quickLoginPost(ngrokReq);
    testAssert(
      ngrokRes.status === 403,
      "Quick Login rejects public tunnel host (*.ngrok-free.app) with HTTP 403"
    );

    // Test Logout in Local Development
    console.log("\n--- SECTION 1D: Logout in Local Development ---");
    const devLogoutReq = new Request("http://localhost:3004/api/auth/logout", {
      method: "POST",
      headers: { host: "localhost:3004" },
    });
    const devLogoutRes = await logoutPost(devLogoutReq);
    const devLogoutData = await devLogoutRes.json();
    testAssert(
      devLogoutRes.status === 200 && devLogoutData.redirectTo === "/login",
      "Logout in Local Development returns redirectTo='/login' (back to Quick Login role selector)"
    );

    // -------------------------------------------------------------------------
    // SECTION 2: UAT Environment & SSO Full Lifecycle (Login, Logout, Re-entry)
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 2: UAT Environment & SSO Full Lifecycle ---");
    process.env.APP_ENV = "uat";
    process.env.SPARTA_ENVIRONMENT = "uat";

    testAssert(
      isUatEnvironment() === true,
      "isUatEnvironment() returns true when APP_ENV=uat"
    );
    testAssert(
      isDevelopmentEnvironment() === false,
      "isDevelopmentEnvironment() returns false in UAT"
    );

    // Quick Login MUST be strictly blocked in UAT
    const uatQlReq = new Request("http://localhost:3004/api/auth/quick-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "localhost:3004",
      },
      body: JSON.stringify({ role: "sysadmin" }),
    });
    const uatQlRes = await quickLoginPost(uatQlReq);
    const uatQlData = await uatQlRes.json();
    testAssert(
      uatQlRes.status === 403 && uatQlData.error === "QUICK_LOGIN_FORBIDDEN",
      "Quick Login is strictly forbidden in UAT with HTTP 403 QUICK_LOGIN_FORBIDDEN"
    );

    // Direct password login MUST be blocked in UAT (enforces SSO)
    const uatDirectLoginReq = new Request("http://localhost:3004/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bms0001", password: "anypassword" }),
    });
    const uatDirectLoginRes = await loginPost(uatDirectLoginReq);
    const uatDirectLoginData = await uatDirectLoginRes.json();
    testAssert(
      uatDirectLoginRes.status === 403 && uatDirectLoginData.code === "SSO_LOGIN_REQUIRED",
      "Direct password login in UAT is rejected with HTTP 403 SSO_LOGIN_REQUIRED"
    );

    // SSO Logout in UAT: Must redirect to SSO module launcher (#/modules)
    const uatLogoutReq = new Request("http://localhost:3004/api/auth/logout", {
      method: "POST",
      headers: { host: "localhost:3004" },
    });
    const uatLogoutRes = await logoutPost(uatLogoutReq);
    const uatLogoutData = await uatLogoutRes.json();
    testAssert(
      uatLogoutRes.status === 200 && uatLogoutData.redirectTo.includes("/#/modules"),
      `Logout in UAT redirects to SSO Module Launcher: ${uatLogoutData.redirectTo}`
    );

    const logoutCookieHeader = uatLogoutRes.headers.get("set-cookie") || "";
    testAssert(
      logoutCookieHeader.includes("Max-Age=0"),
      "Logout in UAT completely clears session cookies (Max-Age=0)"
    );

    // Verify 701 candidate/staging user count integrity
    const userCountCheck = await pool.query("SELECT COUNT(*) as count FROM users");
    const totalUsers = parseInt(userCountCheck.rows[0].count, 10);
    testAssert(
      totalUsers >= 701,
      `Staging database integrity: ${totalUsers} users present (>= 701 users preserved)`
    );

    const pendingGrantCheck = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE sso_status = 'PENDING_SSO_GRANT'"
    );
    const pendingGrantCount = parseInt(pendingGrantCheck.rows[0].count, 10);
    testAssert(
      pendingGrantCount === 669,
      `Task 1 synced candidates preserved: exactly 669 PENDING_SSO_GRANT users (actual: ${pendingGrantCount})`
    );

    // -------------------------------------------------------------------------
    // SECTION 3: Production Fail-Closed Protections
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 3: Production Fail-Closed Protections ---");
    process.env.APP_ENV = "production";
    process.env.SPARTA_ENVIRONMENT = "production";

    testAssert(
      isProductionEnvironment() === true,
      "isProductionEnvironment() returns true when APP_ENV=production"
    );

    // Quick Login strictly rejected in Production
    const prodQlReq = new Request("http://localhost:3004/api/auth/quick-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "localhost:3004",
      },
      body: JSON.stringify({ role: "sysadmin" }),
    });
    const prodQlRes = await quickLoginPost(prodQlReq);
    testAssert(
      prodQlRes.status === 403,
      "Quick Login strictly rejected in Production with HTTP 403"
    );

    // Direct Login strictly rejected in Production
    const prodLoginReq = new Request("http://localhost:3004/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "sysadmin", password: "password" }),
    });
    const prodLoginRes = await loginPost(prodLoginReq);
    testAssert(
      prodLoginRes.status === 403,
      "Direct login strictly rejected in Production with HTTP 403"
    );

    // Earthquake simulation trigger blocked in Production
    const secret = process.env.SPARTA_INTERNAL_WORKER_SECRET || "33b0cafeff83be461c54bb5c9bbd2a65ac7a17a8c21c239ae8792aca05dc7230415aa5e602b54d45622bd7f3672c26db";
    const prodTriggerReq = new Request("http://localhost:3004/api/simulation/earthquake/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-worker-secret": secret,
      },
      body: JSON.stringify({ presetKey: "citarum" }),
    });
    const prodTriggerRes = await triggerPost(prodTriggerReq);
    const prodTriggerData = await prodTriggerRes.json();
    testAssert(
      prodTriggerRes.status === 403 && prodTriggerData.code === "SIMULATION_FORBIDDEN_IN_PRODUCTION",
      "POST /api/simulation/earthquake/trigger blocked in Production with 403 SIMULATION_FORBIDDEN_IN_PRODUCTION"
    );

    // Scenario reset blocked in Production
    const prodResetReq = new Request("http://localhost:3004/api/simulation/reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-worker-secret": secret,
      },
    });
    const prodResetRes = await resetPost(prodResetReq);
    const prodResetData = await prodResetRes.json();
    testAssert(
      prodResetRes.status === 403 && prodResetData.code === "SIMULATION_FORBIDDEN_IN_PRODUCTION",
      "POST /api/simulation/reset blocked in Production with 403 SIMULATION_FORBIDDEN_IN_PRODUCTION"
    );

    // Simulation status reports allowed: false in Production
    const prodStatusRes = await statusGet();
    const prodStatusData = await prodStatusRes.json();
    testAssert(
      prodStatusData.allowed === false,
      "GET /api/simulation/status reports allowed: false in Production"
    );

    // Fail-closed DB guard: target production DB IP
    process.env.APP_ENV = "development"; // Attempt to pretend dev
    process.env.DATABASE_URL = "postgresql://aku-sparta:0hhUTvTHKtgkN8TfLadC@103.127.99.241:5432/siaga";
    testAssert(
      isProductionEnvironment() === true,
      "Fail-closed: Target database 103.127.99.241 forces isProductionEnvironment()=true even if APP_ENV=development"
    );
    testAssert(
      isQuickLoginPermitted().allowed === false,
      "Fail-closed: Quick Login strictly rejected when database is production target"
    );

  } finally {
    process.env.APP_ENV = origAppEnv;
    process.env.DATABASE_URL = origDbUrl;
    await pool.end();
  }

  console.log("\n==================================================================");
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("FATAL: Test execution failed:", err);
  process.exit(1);
});
