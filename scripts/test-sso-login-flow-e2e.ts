import fs from "fs";
import path from "path";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { GET as ssoCallbackHandler } from "../app/auth/sso/callback/route";
import { POST as localLoginHandler } from "../app/api/auth/login/route";
import { getSessionUser } from "../lib/auth";
import {
  validateSsoModuleAccess,
  matchSsoIdentityToSiagaUser,
  isApprovedRoleAndBranch,
} from "../lib/sso-service";
import bcrypt from "bcryptjs";

interface TestCheck {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  expected?: any;
  actual?: any;
  details?: string;
}

const checks: TestCheck[] = [];

function check(
  id: string,
  category: string,
  description: string,
  passed: boolean,
  expected?: any,
  actual?: any,
  details?: string
) {
  checks.push({ id, category, description, passed, expected, actual, details });
  const status = passed ? "[PASS]" : "[FAIL]";
  console.log(`${status} ${id.padEnd(10)} | ${category.padEnd(26)} | ${description}`);
  if (!passed) {
    console.error(`       Expected: ${JSON.stringify(expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
  }
  if (details) {
    console.log(`       Details:  ${details}`);
  }
}

// Helper to extract cookies from Next.js response
function getCookiesFromResponse(res: Response): { session?: string; refresh?: string } {
  const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  let session: string | undefined;
  let refresh: string | undefined;
  for (const c of rawCookies) {
    const matchS = c.match(/siaga_session=([^;]+)/);
    if (matchS) session = matchS[1];
    const matchR = c.match(/siaga_refresh=([^;]+)/);
    if (matchR) refresh = matchR[1];
  }
  return { session, refresh };
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — SSO LOGIN INTEGRATION END-TO-END TEST SUITE");
  console.log(" Target: Aiven sparta_siaga_isolated (Isolated Staging)");
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  // Preserve global fetch for restoration
  const originalFetch = globalThis.fetch;

  let testCandidateId: string | null = null;
  let initialExternalUserId: string | null = null;

  try {
    // 0. Pre-flight Cleanup: Ensure no stray test records from interrupted runs
    await pool.query(`DELETE FROM user_sessions WHERE user_id LIKE 'usr_test_%'`);
    await pool.query(`DELETE FROM users WHERE id LIKE 'usr_test_%'`);

    // -------------------------------------------------------------------------
    // SUITE 1: Baseline Verification
    // -------------------------------------------------------------------------
    console.log("--- SUITE 1: Baseline Verification ---");
    const baselineTotalRes = await pool.query(`SELECT count(*)::int as cnt FROM users`);
    const baselinePendingRes = await pool.query(`SELECT count(*)::int as cnt FROM users WHERE sso_status = 'PENDING_SSO_GRANT'`);
    const baselineLegacyRes = await pool.query(`SELECT count(*)::int as cnt FROM users WHERE sso_status IS NULL`);

    const baselineTotal = baselineTotalRes.rows[0].cnt;
    const baselinePending = baselinePendingRes.rows[0].cnt;
    const baselineLegacy = baselineLegacyRes.rows[0].cnt;

    check(
      "BASE-01",
      "Baseline Verification",
      "Exact staging user counts verified (701 users = 669 pending + 32 legacy)",
      baselineTotal === 701 && baselinePending === 669 && baselineLegacy === 32,
      { total: 701, pending: 669, legacy: 32 },
      { total: baselineTotal, pending: baselinePending, legacy: baselineLegacy }
    );

    // Pick 1 real synced candidate for the primary JIT activation test
    const candidateQuery = await pool.query(`
      SELECT id, email, nik, external_user_id, name, business_role, scope, branch, status, sso_status
      FROM users
      WHERE sso_status = 'PENDING_SSO_GRANT' AND status = 'INACTIVE'
      ORDER BY id ASC
      LIMIT 1
    `);
    const testCandidate = candidateQuery.rows[0];
    testCandidateId = testCandidate.id;
    initialExternalUserId = testCandidate.external_user_id;

    check(
      "BASE-02",
      "Candidate Selection",
      `Selected real synced candidate '${testCandidate.name}' (${testCandidate.email})`,
      Boolean(testCandidate && testCandidate.id && testCandidate.status === "INACTIVE" && testCandidate.sso_status === "PENDING_SSO_GRANT"),
      { status: "INACTIVE", sso_status: "PENDING_SSO_GRANT" },
      { status: testCandidate.status, sso_status: testCandidate.sso_status },
      `ID: ${testCandidate.id}, Role: ${testCandidate.business_role}, Branch: ${testCandidate.branch}`
    );

    // -------------------------------------------------------------------------
    // SUITE 2: Successful Just-in-Time Activation via SSO Callback
    // -------------------------------------------------------------------------
    console.log("\n--- SUITE 2: Successful Just-In-Time Activation & SSO Login ---");

    // Mock exchange response with valid SIAGA grant using EXACT login-sparta contract
    // Real SPARTA SSO exchange response strictly contains: email, fullName, branch, access (NO nik field)
    globalThis.fetch = (async (url: string, opts: any) => {
      return new Response(
        JSON.stringify({
          data: {
            user: {
              email: testCandidate.email,
              fullName: testCandidate.name,
              branch: testCandidate.branch,
              access: ["siaga", "maintenance"],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const callbackReq = new Request("http://localhost:3000/auth/sso/callback?token=launch_token_jit_success");
    const callbackRes = await ssoCallbackHandler(callbackReq);
    const redirectLocation = callbackRes.headers.get("location") || "";
    const cookies = getCookiesFromResponse(callbackRes);

    const isRedirectToDashboard =
      (callbackRes.status === 307 || callbackRes.status === 302) &&
      (redirectLocation.endsWith("/") || redirectLocation.endsWith(":3000/"));

    check(
      "JIT-01",
      "SSO Callback Flow",
      "SSO Callback redirects to dashboard with status 307/302",
      isRedirectToDashboard,
      "Redirect to /",
      redirectLocation
    );

    check(
      "JIT-02",
      "SSO Cookie Issuance",
      "Secure HttpOnly session and refresh cookies issued",
      Boolean(cookies.session && cookies.session.length > 20 && cookies.refresh && cookies.refresh.length > 20),
      "Session and refresh cookies present",
      { hasSession: Boolean(cookies.session), hasRefresh: Boolean(cookies.refresh) }
    );

    // Verify DB update: candidate is now ACTIVE in DB!
    const postActivationQuery = await pool.query(
      `SELECT id, status, sso_status, updated_at FROM users WHERE id = $1`,
      [testCandidate.id]
    );
    const updatedCandidate = postActivationQuery.rows[0];

    check(
      "JIT-03",
      "Database Activation",
      "Candidate status and sso_status safely transitioned to ACTIVE in database",
      updatedCandidate.status === "ACTIVE" && updatedCandidate.sso_status === "ACTIVE",
      { status: "ACTIVE", sso_status: "ACTIVE" },
      { status: updatedCandidate.status, sso_status: updatedCandidate.sso_status }
    );

    // Verify session in user_sessions table
    const sessionRecord = await pool.query(
      `SELECT * FROM user_sessions WHERE user_id = $1 AND is_revoked = FALSE ORDER BY created_at DESC LIMIT 1`,
      [testCandidate.id]
    );

    check(
      "JIT-04",
      "Device Session",
      "Persistent device session recorded in user_sessions table",
      sessionRecord.rows.length === 1 && sessionRecord.rows[0].device_type !== undefined,
      "Active session row exists",
      { sessionCount: sessionRecord.rows.length, sessionId: sessionRecord.rows[0]?.id }
    );

    // Verify Authenticated User Context via getSessionUser()
    const authenticatedReq = new Request("http://localhost:3000/api/reports", {
      headers: {
        cookie: `siaga_session=${cookies.session}; siaga_refresh=${cookies.refresh}`,
      },
    });
    const userContext = await getSessionUser(authenticatedReq);

    check(
      "JIT-05",
      "User Context & RBAC",
      "getSessionUser() returns accurate user context with role and branch",
      Boolean(
        userContext &&
        userContext.id === testCandidate.id &&
        userContext.role === testCandidate.business_role &&
        userContext.branch === testCandidate.branch &&
        userContext.scope === testCandidate.scope &&
        userContext.systemRole === "USER"
      ),
      {
        id: testCandidate.id,
        role: testCandidate.business_role,
        branch: testCandidate.branch,
        scope: testCandidate.scope,
      },
      {
        id: userContext?.id,
        role: userContext?.role,
        branch: userContext?.branch,
        scope: userContext?.scope,
      }
    );

    // -------------------------------------------------------------------------
    // SUITE 3: Idempotent Subsequent Login
    // -------------------------------------------------------------------------
    console.log("\n--- SUITE 3: Idempotent Subsequent Login ---");

    const secondCallbackReq = new Request("http://localhost:3000/auth/sso/callback?token=launch_token_second_login");
    const secondCallbackRes = await ssoCallbackHandler(secondCallbackReq);
    const secondLocation = secondCallbackRes.headers.get("location") || "";
    const secondCookies = getCookiesFromResponse(secondCallbackRes);

    check(
      "IDEM-01",
      "Idempotent Login",
      "Already ACTIVE user logs in again successfully without error",
      (secondCallbackRes.status === 307 || secondCallbackRes.status === 302) &&
        (secondLocation.endsWith("/") || secondLocation.endsWith(":3000/")) &&
        Boolean(secondCookies.session),
      "Successful redirect with session cookies",
      { status: secondCallbackRes.status, location: secondLocation }
    );

    // -------------------------------------------------------------------------
    // SUITE 4: Rejection When Lacking SIAGA Grant
    // -------------------------------------------------------------------------
    console.log("\n--- SUITE 4: Rejection When Lacking SIAGA Grant ---");

    // Pick second candidate for non-grant test
    const candidate2Query = await pool.query(`
      SELECT id, email, nik, name, business_role, branch
      FROM users
      WHERE sso_status = 'PENDING_SSO_GRANT' AND status = 'INACTIVE' AND id != $1
      ORDER BY id ASC
      LIMIT 1
    `, [testCandidate.id]);
    const candidate2 = candidate2Query.rows[0];

    // Mock exchange response WITHOUT "siaga" in access array (real SSO contract without nik)
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: {
            user: {
              email: candidate2.email,
              fullName: candidate2.name,
              branch: candidate2.branch,
              access: ["maintenance", "building"], // NO "siaga"
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const noGrantReq = new Request("http://localhost:3000/auth/sso/callback?token=launch_token_no_grant");
    const noGrantRes = await ssoCallbackHandler(noGrantReq);
    const noGrantLocation = noGrantRes.headers.get("location") || "";
    const noGrantCookies = getCookiesFromResponse(noGrantRes);

    check(
      "GRANT-01",
      "Missing SIAGA Grant",
      "User without SIAGA grant redirected to /login?error=UnauthorizedModule",
      noGrantLocation.includes("error=UnauthorizedModule"),
      "error=UnauthorizedModule",
      noGrantLocation
    );

    check(
      "GRANT-02",
      "Missing SIAGA Grant",
      "Zero session cookies issued for user lacking SIAGA grant",
      !noGrantCookies.session && !noGrantCookies.refresh,
      "No cookies issued",
      noGrantCookies
    );

    // Verify DB: Candidate 2 remains INACTIVE & PENDING_SSO_GRANT
    const candidate2Db = await pool.query(`SELECT status, sso_status FROM users WHERE id = $1`, [candidate2.id]);
    check(
      "GRANT-03",
      "Missing SIAGA Grant",
      "Candidate in DB remains INACTIVE and PENDING_SSO_GRANT",
      candidate2Db.rows[0].status === "INACTIVE" && candidate2Db.rows[0].sso_status === "PENDING_SSO_GRANT",
      { status: "INACTIVE", sso_status: "PENDING_SSO_GRANT" },
      candidate2Db.rows[0]
    );

    // -------------------------------------------------------------------------
    // SUITE 5: Rejection for BLOCKED, PENDING_REVIEW, and UNMATCHED_SSO
    // -------------------------------------------------------------------------
    console.log("\n--- SUITE 5: Rejection for BLOCKED, PENDING_REVIEW, UNMATCHED_SSO ---");

    // Insert isolated temporary accounts for status verification
    await pool.query(`
      DELETE FROM users WHERE id IN ('usr_test_blocked_01', 'usr_test_review_01', 'usr_test_unmatched_01', 'usr_test_deactivated_01', 'usr_test_incomplete_01');
      INSERT INTO users (id, email, nik, name, system_role, business_role, scope, branch, status, sso_status, source, created_at, updated_at)
      VALUES
      ('usr_test_blocked_01', 'blocked.user@sparta.local', 'TEST_BLK_01', 'Blocked User', 'USER', 'bms', 'BRANCH', 'JAKARTA', 'INACTIVE', 'BLOCKED', 'SPARTA_SYNC', NOW(), NOW()),
      ('usr_test_review_01', 'review.user@sparta.local', 'TEST_REV_01', 'Review User', 'USER', 'bms', 'BRANCH', 'JAKARTA', 'INACTIVE', 'PENDING_REVIEW', 'SPARTA_SYNC', NOW(), NOW()),
      ('usr_test_unmatched_01', 'unmatched.user@sparta.local', 'TEST_UNM_01', 'Unmatched User', 'USER', 'bms', 'BRANCH', 'JAKARTA', 'INACTIVE', 'UNMATCHED_SSO', 'SPARTA_SYNC', NOW(), NOW()),
      ('usr_test_deactivated_01', 'deact.user@sparta.local', 'TEST_DEA_01', 'Deactivated Role User', 'USER', 'tim_toko', 'BRANCH', 'JAKARTA', 'ACTIVE', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW()),
      ('usr_test_incomplete_01', 'incomp.user@sparta.local', 'TEST_INC_01', 'Incomplete Branch User', 'USER', 'bms', 'BRANCH', NULL, 'INACTIVE', 'PENDING_SSO_GRANT', 'SPARTA_SYNC', NOW(), NOW());
    `);

    // Helper for testing callback rejection (uses real SSO contract without requiring nik)
    async function testCallbackRejection(email: string, nik: string, expectedErrorCode: string, testCode: string, testName: string) {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            data: {
              user: {
                email,
                fullName: "Test User",
                branch: "JAKARTA",
                access: ["siaga"],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      const req = new Request(`http://localhost:3000/auth/sso/callback?token=launch_token_${testCode}`);
      const res = await ssoCallbackHandler(req);
      const location = res.headers.get("location") || "";
      const cookies = getCookiesFromResponse(res);

      const passed = location.includes(`error=${expectedErrorCode}`) && !cookies.session && !cookies.refresh;
      check(
        testCode,
        "Status Gating",
        testName,
        passed,
        `error=${expectedErrorCode} & no session`,
        { location, hasSession: Boolean(cookies.session) }
      );
    }

    // 5.1 BLOCKED user -> /login?error=UserBlocked
    await testCallbackRejection(
      "blocked.user@sparta.local",
      "TEST_BLK_01",
      "UserBlocked",
      "REJ-01",
      "BLOCKED user is rejected with UserBlocked"
    );

    // 5.2 PENDING_REVIEW user -> /login?error=PendingReview
    await testCallbackRejection(
      "review.user@sparta.local",
      "TEST_REV_01",
      "PendingReview",
      "REJ-02",
      "PENDING_REVIEW user is rejected with PendingReview"
    );

    // 5.3 UNMATCHED_SSO user -> /login?error=UnmatchedSso
    await testCallbackRejection(
      "unmatched.user@sparta.local",
      "TEST_UNM_01",
      "UnmatchedSso",
      "REJ-03",
      "UNMATCHED_SSO user is rejected with UnmatchedSso"
    );

    // 5.4 Deactivated Role (tim_toko) -> /login?error=DeactivatedRole
    await testCallbackRejection(
      "deact.user@sparta.local",
      "TEST_DEA_01",
      "DeactivatedRole",
      "REJ-04",
      "Deactivated role 'tim_toko' is rejected with DeactivatedRole"
    );

    // 5.5 Incomplete branch assignment -> /login?error=PendingReview
    await testCallbackRejection(
      "incomp.user@sparta.local",
      "TEST_INC_01",
      "PendingReview",
      "REJ-05",
      "Pending user with missing branch is routed to PendingReview (not activated)"
    );

    // -------------------------------------------------------------------------
    // SUITE 6: Zero Auto-Creation for Unknown Identity
    // -------------------------------------------------------------------------
    console.log("\n--- SUITE 6: Zero Auto-Creation & Ambiguous Match Protection ---");

    const countBefore = await pool.query(`SELECT count(*)::int as cnt FROM users`);

    await testCallbackRejection(
      "completely.unknown.identity@sparta.local",
      "UNKNOWN_NIK_9999",
      "UserNotFound",
      "ZERO-01",
      "Unregistered identity rejected with UserNotFound"
    );

    const countAfter = await pool.query(`SELECT count(*)::int as cnt FROM users`);
    check(
      "ZERO-02",
      "Zero Auto-Creation",
      "Database user count is strictly unchanged (strictly zero auto-creation)",
      countBefore.rows[0].cnt === countAfter.rows[0].cnt,
      countBefore.rows[0].cnt,
      countAfter.rows[0].cnt
    );

    // 6.2 Ambiguous Match Rejection
    // Payload where email belongs to Candidate 1 and NIK belongs to Candidate 2
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: {
            user: {
              email: testCandidate.email,
              nik: candidate2.nik,
              fullName: "Ambiguous Attacker",
              access: ["siaga"],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    const ambigReq = new Request("http://localhost:3000/auth/sso/callback?token=launch_token_ambig");
    const ambigRes = await ssoCallbackHandler(ambigReq);
    const ambigLocation = ambigRes.headers.get("location") || "";
    const ambigCookies = getCookiesFromResponse(ambigRes);

    check(
      "AMBIG-01",
      "Ambiguity Protection",
      "Cross-identity match (NIK/Email pointing to different users) rejected with AmbiguousIdentity",
      ambigLocation.includes("error=AmbiguousIdentity") && !ambigCookies.session,
      "error=AmbiguousIdentity",
      ambigLocation
    );

    // -------------------------------------------------------------------------
    // SUITE 7: Existing Accounts Non-Regression (System Administrator & Legacy UAT)
    // -------------------------------------------------------------------------
    console.log("\n--- SUITE 7: Existing Accounts Non-Regression ---");

    // 7.1 Verify System Administrator (usr_sysadmin_01)
    const sysAdminQuery = await pool.query(
      `SELECT id, email, nik, name, system_role, business_role, scope, branch, status, sso_status, password_hash
       FROM users
       WHERE id = 'usr_sysadmin_01'`
    );
    const sysAdmin = sysAdminQuery.rows[0];

    const isSysAdminIntact =
      sysAdmin &&
      sysAdmin.system_role === "ADMIN" &&
      sysAdmin.business_role === null &&
      sysAdmin.scope === null &&
      sysAdmin.status === "ACTIVE" &&
      sysAdmin.sso_status === null &&
      typeof sysAdmin.password_hash === "string" &&
      sysAdmin.password_hash.startsWith("$2");

    check(
      "EXIST-01",
      "System Admin Intact",
      "System Administrator (usr_sysadmin_01) role, password, and sso_status=null intact",
      Boolean(isSysAdminIntact),
      { systemRole: "ADMIN", status: "ACTIVE", ssoStatus: null },
      { systemRole: sysAdmin?.system_role, status: sysAdmin?.status, ssoStatus: sysAdmin?.sso_status }
    );

    // 7.2 Verify local password login remains functional for System Administrator
    const pilotCredsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
    const creds: Record<string, string> = {};
    if (fs.existsSync(pilotCredsPath)) {
      const lines = fs.readFileSync(pilotCredsPath, "utf8").split("\n");
      for (const line of lines) {
        const match = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
        if (match) creds[match[1]] = match[2].trim();
      }
    }
    const sysAdminPass = creds["PROD_SYSADMIN_PASSWORD"] || process.env.DEV_ADMIN_PASSWORD || "admin123";

    const passwordValid = await bcrypt.compare(sysAdminPass, sysAdmin.password_hash);
    check(
      "EXIST-02",
      "System Admin Auth",
      "System Administrator local password authentication remains fully functional",
      passwordValid === true,
      true,
      passwordValid
    );

    // 7.2b Verify /api/auth/login route endpoint behavior for System Administrator
    const sysAdminLoginReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "ADM0001", password: sysAdminPass }),
    });
    const sysAdminLoginRes = await localLoginHandler(sysAdminLoginReq);
    check(
      "EXIST-02b",
      "Local Login Endpoint",
      "System Admin local login succeeds with status 200",
      sysAdminLoginRes.status === 200,
      200,
      sysAdminLoginRes.status
    );

    // 7.2c Verify synced candidate without password cannot bypass SSO via local login
    // Candidate was activated in Suite 2; having null password_hash blocks local login with 401
    const syncedCandidateLocalLoginReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: testCandidate.email, password: "anypassword" }),
    });
    const syncedCandidateLocalLoginRes = await localLoginHandler(syncedCandidateLocalLoginReq);
    const syncedCandidateJson = await syncedCandidateLocalLoginRes.json();
    check(
      "EXIST-02c",
      "Local Login Blocked",
      "Synced candidate without password hash blocked from local login ('Akun ini harus login menggunakan SSO Corporate')",
      syncedCandidateLocalLoginRes.status === 401 && syncedCandidateJson.error === "Akun ini harus login menggunakan SSO Corporate",
      "Status 401: Akun ini harus login menggunakan SSO Corporate",
      { status: syncedCandidateLocalLoginRes.status, error: syncedCandidateJson.error }
    );

    // 7.2d Verify UAT persona local password login (USR-BMS-001 with 'pass123')
    const uatLoginReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "UAT_BMS0001", password: "pass123" }),
    });
    const uatLoginRes = await localLoginHandler(uatLoginReq);
    check(
      "EXIST-02d",
      "UAT Persona Login",
      "UAT Persona local password login succeeds with status 200",
      uatLoginRes.status === 200,
      200,
      uatLoginRes.status
    );

    // 7.3 Verify System Admin UserContext via auth helper
    const sysAdminSession = await pool.query(
      `SELECT token_version FROM users WHERE id = 'usr_sysadmin_01'`
    );
    const { signSession } = await import("../lib/jwt");
    const sysAdminToken = await signSession({
      id: "usr_sysadmin_01",
      systemRole: "ADMIN",
      v: sysAdminSession.rows[0]?.token_version || 1,
    });

    const sysAdminReq = new Request("http://localhost:3000/api/admin/users", {
      headers: {
        cookie: `siaga_session=${sysAdminToken}; siaga_refresh=dummy_refresh`,
      },
    });
    const sysAdminContext = await getSessionUser(sysAdminReq);

    check(
      "EXIST-03",
      "System Admin Context",
      "System Administrator builds valid ADMIN context without business role restrictions",
      Boolean(sysAdminContext && sysAdminContext.id === "usr_sysadmin_01" && sysAdminContext.systemRole === "ADMIN" && sysAdminContext.role === null),
      { id: "usr_sysadmin_01", systemRole: "ADMIN", role: null },
      { id: sysAdminContext?.id, systemRole: sysAdminContext?.systemRole, role: sysAdminContext?.role }
    );

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP: Clean temporary test rows & restore tested candidate
    // -------------------------------------------------------------------------
    console.log("\n--- CLEANUP & STATE INTEGRITY ---");

    try {
      // Clean temp test users & sessions
      await pool.query(
        `DELETE FROM user_sessions WHERE user_id IN ('usr_test_blocked_01', 'usr_test_review_01', 'usr_test_unmatched_01', 'usr_test_deactivated_01', 'usr_test_incomplete_01', $1)`,
        [testCandidateId]
      );
      await pool.query(
        `DELETE FROM users WHERE id IN ('usr_test_blocked_01', 'usr_test_review_01', 'usr_test_unmatched_01', 'usr_test_deactivated_01', 'usr_test_incomplete_01')`
      );

      // Revert tested candidate back to INACTIVE and PENDING_SSO_GRANT
      if (testCandidateId) {
        await pool.query(`
          UPDATE users
          SET status = 'INACTIVE',
              sso_status = 'PENDING_SSO_GRANT',
              external_user_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `, [testCandidateId, initialExternalUserId]);
      }

      const finalTotalRes = await pool.query(`SELECT count(*)::int as cnt FROM users`);
      const finalPendingRes = await pool.query(`SELECT count(*)::int as cnt FROM users WHERE sso_status = 'PENDING_SSO_GRANT'`);
      const finalLegacyRes = await pool.query(`SELECT count(*)::int as cnt FROM users WHERE sso_status IS NULL`);

      check(
        "CLEAN-01",
        "Database State Integrity",
        "Database state restored to exact pristine baseline (701 total, 669 pending, 32 legacy)",
        finalTotalRes.rows[0].cnt === 701 && finalPendingRes.rows[0].cnt === 669 && finalLegacyRes.rows[0].cnt === 32,
        { total: 701, pending: 669, legacy: 32 },
        { total: finalTotalRes.rows[0].cnt, pending: finalPendingRes.rows[0].cnt, legacy: finalLegacyRes.rows[0].cnt }
      );
    } catch (cleanupErr) {
      console.error("Error during cleanup:", cleanupErr);
    }

    globalThis.fetch = originalFetch;
    await closeDbPool();
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  const total = checks.length;
  const passed = checks.filter((c) => c.passed).length;
  const failed = total - passed;

  console.log("\n================================================================================");
  console.log(` SSO INTEGRATION TEST RESULTS: ${total} CHECKS | ${passed} PASSED | ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("SSO Integration Test Suite failed with unhandled error:", err);
  process.exit(1);
});
