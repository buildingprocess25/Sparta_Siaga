import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import {
  exchangeSpartaLaunchToken,
  validateSsoModuleAccess,
  matchSsoIdentityToSiagaUser,
  createSsoSessionForUser,
  mapSsoErrorCodeToRedirect,
  SsoExchangeUser,
} from "../lib/sso-service";
import { GET as ssoCallbackHandler } from "../app/auth/sso/callback/route";

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
  console.log(`[${statusStr}] ${res.code.padEnd(8)} | ${res.name.padEnd(50)} | ${res.details || ""}`);
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — TASK 2: SSO CALLBACK INTEGRATION VERIFICATION");
  console.log(" Target: Aiven sparta_siaga_isolated (Isolated Staging)");
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  // Setup test users in isolated DB
  const testSsoActiveEmail = "sso.active.bms@sparta.local";
  const testSsoActiveNik = "SSO_TEST_BMS_01";
  const testSsoInactiveEmail = "sso.inactive.bms@sparta.local";
  const testSsoInactiveNik = "SSO_TEST_INACTIVE_01";
  const testAmbiguousEmail = "sso.ambig.userb@sparta.local";
  const testAmbiguousNik = "SSO_AMBIG_NIK_A";

  // Cleanup test users first
  await pool.query(
    `DELETE FROM users WHERE LOWER(TRIM(email)) IN ($1, $2, $3) OR LOWER(TRIM(nik)) IN ($4, $5, $6, 'sso_ambig_nik_b')`,
    [
      testSsoActiveEmail.toLowerCase(),
      testSsoInactiveEmail.toLowerCase(),
      testAmbiguousEmail.toLowerCase(),
      testSsoActiveNik.toLowerCase(),
      testSsoInactiveNik.toLowerCase(),
      testAmbiguousNik.toLowerCase(),
    ]
  );

  // Insert seed users in isolated database
  await pool.query(
    `INSERT INTO users (id, external_user_id, nik, name, email, system_role, business_role, scope, branch, status, source, created_at, updated_at)
     VALUES
     ('usr_sso_active_01', 'ext_sso_01', $1, 'Active SSO BMS Bandung', $2, 'USER', 'bms', 'BRANCH', 'BANDUNG', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW()),
     ('usr_sso_inactive_01', 'ext_sso_02', $3, 'Inactive SSO User', $4, 'USER', 'bms', 'BRANCH', 'BANDUNG', 'INACTIVE', 'SPARTA_SYNC', NOW(), NOW()),
     ('usr_sso_ambig_a', 'ext_ambig_a', $5, 'Ambiguous User A', 'sso.ambig.usera@sparta.local', 'USER', 'bms', 'BRANCH', 'BANDUNG', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW()),
     ('usr_sso_ambig_b', 'ext_ambig_b', 'sso_ambig_nik_b', 'Ambiguous User B', $6, 'USER', 'bes', 'BRANCH', 'BANDUNG', 'ACTIVE', 'SPARTA_SYNC', NOW(), NOW())`,
    [
      testSsoActiveNik,
      testSsoActiveEmail,
      testSsoInactiveNik,
      testSsoInactiveEmail,
      testAmbiguousNik,
      testAmbiguousEmail,
    ]
  );

  // ---------------------------------------------------------------------------
  // SUITE 1: Module Access Validation
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 1: Module Access Validation ---");

  // 1.1 User with "siaga" in access array
  {
    const userWithSiaga: SsoExchangeUser = {
      email: "test@sparta.local",
      access: ["building", "maintenance", "siaga"],
    };
    const passed = validateSsoModuleAccess(userWithSiaga) === true;
    record({
      code: "MOD-01",
      name: "User with 'siaga' module access allowed",
      passed,
      details: `access: [${userWithSiaga.access?.join(", ")}] -> hasAccess: ${passed}`,
    });
  }

  // 1.2 User without "siaga" in access array
  {
    const userWithoutSiaga: SsoExchangeUser = {
      email: "test@sparta.local",
      access: ["building", "maintenance", "energy"],
    };
    const passed = validateSsoModuleAccess(userWithoutSiaga) === false;
    record({
      code: "MOD-02",
      name: "User lacking 'siaga' module access denied",
      passed,
      details: `access: [${userWithoutSiaga.access?.join(", ")}] -> hasAccess: false`,
    });
  }

  // 1.3 User with missing or empty access
  {
    const userEmptyAccess: SsoExchangeUser = { email: "test@sparta.local", access: [] };
    const passed = validateSsoModuleAccess(userEmptyAccess) === false;
    record({
      code: "MOD-03",
      name: "User with empty access denied",
      passed,
      details: "access: [] -> hasAccess: false",
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 2: Identity Matching Invariants
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 2: Identity Matching Invariants ---");

  // 2.1 Match active existing user by Email
  {
    const match = await matchSsoIdentityToSiagaUser({
      email: testSsoActiveEmail,
    });
    const passed = match.status === "MATCHED" && match.user.id === "usr_sso_active_01";
    record({
      code: "ID-01",
      name: "Match Active User by Normalized Email",
      passed,
      details: `status: ${match.status}, userId: ${match.status === "MATCHED" ? match.user.id : "none"}`,
    });
  }

  // 2.2 Match active existing user by NIK
  {
    const match = await matchSsoIdentityToSiagaUser({
      nik: testSsoActiveNik,
    });
    const passed = match.status === "MATCHED" && match.user.id === "usr_sso_active_01";
    record({
      code: "ID-02",
      name: "Match Active User by NIK",
      passed,
      details: `status: ${match.status}, userId: ${match.status === "MATCHED" ? match.user.id : "none"}`,
    });
  }

  // 2.3 Non-existent user -> NOT_FOUND (strictly no automatic user creation)
  {
    const countBefore = await pool.query(`SELECT count(*)::int as count FROM users`);
    const match = await matchSsoIdentityToSiagaUser({
      email: "completely.nonexistent.user@sparta.local",
      nik: "NIK_NON_EXISTENT_999",
    });
    const countAfter = await pool.query(`SELECT count(*)::int as count FROM users`);

    const passed =
      match.status === "NOT_FOUND" &&
      countBefore.rows[0].count === countAfter.rows[0].count;

    record({
      code: "ID-03",
      name: "Non-Existent User Rejected (Zero Auto-Creation)",
      passed,
      details: `status: ${match.status}, DB user count before: ${countBefore.rows[0].count}, after: ${countAfter.rows[0].count}`,
    });
  }

  // 2.4 Inactive user -> INACTIVE
  {
    const match = await matchSsoIdentityToSiagaUser({
      email: testSsoInactiveEmail,
    });
    const passed = match.status === "INACTIVE";
    record({
      code: "ID-04",
      name: "Inactive Account Rejected",
      passed,
      details: `status: ${match.status}, reason: ${match.status === "INACTIVE" ? match.reason : ""}`,
    });
  }

  // 2.5 Ambiguous cross-identity conflict (NIK matches User A, Email matches User B)
  {
    const match = await matchSsoIdentityToSiagaUser({
      nik: testAmbiguousNik, // points to User A
      email: testAmbiguousEmail, // points to User B
    });
    const passed = match.status === "AMBIGUOUS";
    record({
      code: "ID-05",
      name: "Ambiguous Cross-Identity Match Rejected",
      passed,
      details: `status: ${match.status}, reason: ${match.status === "AMBIGUOUS" ? match.reason : ""}`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: Exchange Service & Token Scenarios (Mocked SPARTA API)
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 3: Token Exchange Scenarios ---");

  // Helper mock fetch
  function createMockFetch(status: number, body: any) {
    return async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
  }

  // 3.1 Successful token exchange
  {
    const mockFetch = createMockFetch(200, {
      data: {
        user: {
          email: testSsoActiveEmail,
          fullName: "Active SSO BMS Bandung",
          branch: "Bandung",
          access: ["siaga", "maintenance"],
        },
      },
    });

    const res = await exchangeSpartaLaunchToken("valid_test_token_1234567890", {
      fetchFn: mockFetch as any,
    });

    const passed = res.success === true && res.user.email === testSsoActiveEmail;
    record({
      code: "EXC-01",
      name: "Successful Token Exchange (HTTP 200)",
      passed,
      details: `success: ${res.success}, email: ${res.success ? res.user.email : "none"}`,
    });
  }

  // 3.2 Invalid token (HTTP 400 INVALID_SSO_TOKEN)
  {
    const mockFetch = createMockFetch(400, {
      error: { code: "INVALID_SSO_TOKEN", message: "Token SSO tidak valid." },
    });

    const res = await exchangeSpartaLaunchToken("invalid_token_1234567890", {
      fetchFn: mockFetch as any,
    });

    const passed = res.success === false && res.errorCode === "INVALID_SSO_TOKEN";
    record({
      code: "EXC-02",
      name: "Invalid Token Gated (INVALID_SSO_TOKEN)",
      passed,
      details: `errorCode: ${!res.success ? res.errorCode : ""}, status: ${!res.success ? res.status : ""}`,
    });
  }

  // 3.3 Expired token (HTTP 400 SSO_TOKEN_EXPIRED)
  {
    const mockFetch = createMockFetch(400, {
      error: { code: "SSO_TOKEN_EXPIRED", message: "Token SSO sudah kedaluwarsa." },
    });

    const res = await exchangeSpartaLaunchToken("expired_token_1234567890", {
      fetchFn: mockFetch as any,
    });

    const passed = res.success === false && res.errorCode === "SSO_TOKEN_EXPIRED";
    record({
      code: "EXC-03",
      name: "Expired Token Gated (SSO_TOKEN_EXPIRED)",
      passed,
      details: `errorCode: ${!res.success ? res.errorCode : ""}`,
    });
  }

  // 3.4 Consumed token (HTTP 400 SSO_TOKEN_CONSUMED)
  {
    const mockFetch = createMockFetch(400, {
      error: { code: "SSO_TOKEN_CONSUMED", message: "Token SSO sudah digunakan." },
    });

    const res = await exchangeSpartaLaunchToken("consumed_token_1234567890", {
      fetchFn: mockFetch as any,
    });

    const passed = res.success === false && res.errorCode === "SSO_TOKEN_CONSUMED";
    record({
      code: "EXC-04",
      name: "Consumed Token Gated (SSO_TOKEN_CONSUMED)",
      passed,
      details: `errorCode: ${!res.success ? res.errorCode : ""}`,
    });
  }

  // 3.5 Module mismatch (HTTP 403 SSO_MODULE_MISMATCH)
  {
    const mockFetch = createMockFetch(403, {
      error: { code: "SSO_MODULE_MISMATCH", message: "Token SSO tidak sesuai modul." },
    });

    const res = await exchangeSpartaLaunchToken("mismatch_token_1234567890", {
      fetchFn: mockFetch as any,
    });

    const passed = res.success === false && res.errorCode === "SSO_MODULE_MISMATCH";
    record({
      code: "EXC-05",
      name: "Module Mismatch Gated (SSO_MODULE_MISMATCH)",
      passed,
      details: `errorCode: ${!res.success ? res.errorCode : ""}, status: ${!res.success ? res.status : ""}`,
    });
  }

  // 3.6 API Unavailable / Network Timeout
  {
    const failingFetch = async () => {
      throw new Error("Connection refused (mock network failure)");
    };

    const res = await exchangeSpartaLaunchToken("any_token_1234567890", {
      fetchFn: failingFetch as any,
    });

    const passed = res.success === false && res.errorCode === "SSO_SERVICE_UNAVAILABLE";
    record({
      code: "EXC-06",
      name: "API Unavailable Handled Gracefully",
      passed,
      details: `errorCode: ${!res.success ? res.errorCode : ""}`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Session Creation & Cookie Security
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 4: Session Creation & Cookie Security ---");

  {
    const dbUserQuery = await pool.query(
      `SELECT * FROM users WHERE LOWER(TRIM(email)) = $1`,
      [testSsoActiveEmail.toLowerCase()]
    );
    const dbUser = dbUserQuery.rows[0];

    const sessionResult = await createSsoSessionForUser({
      id: dbUser.id,
      nik: dbUser.nik,
      name: dbUser.name,
      email: dbUser.email,
      systemRole: dbUser.system_role,
      businessRole: dbUser.business_role,
      scope: dbUser.scope,
      branch: dbUser.branch,
      status: dbUser.status,
      source: dbUser.source,
      tokenVersion: dbUser.token_version,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
    });

    const hasAccessToken = Boolean(sessionResult?.accessToken && sessionResult.accessToken.length > 20);
    const hasRefreshToken = Boolean(sessionResult?.refreshToken && sessionResult.refreshToken.length > 20);
    const sessionInDb = await pool.query(
      `SELECT * FROM user_sessions WHERE user_id = $1 AND is_revoked = FALSE`,
      [dbUser.id]
    );

    const passed =
      hasAccessToken &&
      hasRefreshToken &&
      sessionInDb.rows.length > 0;

    record({
      code: "SESS-01",
      name: "Local Per-Device Session Creation",
      passed,
      details: `Session ID: ${sessionResult?.sessionId}, DB active sessions: ${sessionInDb.rows.length}`,
    });
  }

  // ---------------------------------------------------------------------------
  // SUITE 5: HTTP Callback Endpoint End-to-End Simulation
  // ---------------------------------------------------------------------------
  console.log("\n--- SUITE 5: HTTP Callback Route Simulation ---");

  // Helper to extract cookie from Response
  function getCookieValues(res: Response): { session?: string; refresh?: string } {
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

  // 5.1 Callback without token -> Redirect /login?error=MissingToken
  {
    const req = new Request("http://localhost:3000/auth/sso/callback");
    const res = await ssoCallbackHandler(req);
    const location = res.headers.get("location") || "";
    const passed = res.status === 307 || res.status === 302 ? location.includes("error=MissingToken") : false;
    record({
      code: "ROUTE-01",
      name: "Missing Token Query Param Redirects to Login",
      passed,
      details: `Location: ${location}`,
    });
  }

  // 5.2 Callback with successful exchange & active user -> Redirect to Dashboard with Cookies
  {
    // Temporarily mock global fetch for the route call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            user: {
              email: testSsoActiveEmail,
              fullName: "Active SSO BMS Bandung",
              branch: "Bandung",
              access: ["siaga"],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as any;

    try {
      const req = new Request("http://localhost:3000/auth/sso/callback?token=valid_test_token_launch");
      const res = await ssoCallbackHandler(req);
      const location = res.headers.get("location") || "";
      const cookies = getCookieValues(res);

      const passed =
        Boolean(cookies.session) &&
        Boolean(cookies.refresh) &&
        (location.endsWith("/") || location.endsWith(":3000/"));

      record({
        code: "ROUTE-02",
        name: "Successful SSO Callback Redirects to Dashboard with Cookies",
        passed,
        details: `Destination: '${location}', Session cookie: ${Boolean(cookies.session)}, Refresh cookie: ${Boolean(cookies.refresh)}`,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // 5.3 Callback with module access missing -> Redirect /login?error=UnauthorizedModule
  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            user: {
              email: testSsoActiveEmail,
              fullName: "Active SSO BMS Bandung",
              branch: "Bandung",
              access: ["maintenance", "building"], // 'siaga' is MISSING!
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as any;

    try {
      const req = new Request("http://localhost:3000/auth/sso/callback?token=test_token_no_siaga");
      const res = await ssoCallbackHandler(req);
      const location = res.headers.get("location") || "";
      const cookies = getCookieValues(res);

      const passed =
        location.includes("error=UnauthorizedModule") &&
        !cookies.session &&
        !cookies.refresh;

      record({
        code: "ROUTE-03",
        name: "Unauthorized Module Redirects Without Session",
        passed,
        details: `Location: ${location}, Session issued: ${Boolean(cookies.session)}`,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // 5.4 Callback with user not in SIAGA DB -> Redirect /login?error=UserNotFound
  {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {
            user: {
              email: "unregistered.user@sparta.local",
              fullName: "Unregistered User",
              branch: "Bandung",
              access: ["siaga"],
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as any;

    try {
      const req = new Request("http://localhost:3000/auth/sso/callback?token=test_token_unregistered");
      const res = await ssoCallbackHandler(req);
      const location = res.headers.get("location") || "";
      const cookies = getCookieValues(res);

      const passed =
        location.includes("error=UserNotFound") &&
        !cookies.session;

      record({
        code: "ROUTE-04",
        name: "Unregistered User Redirects to UserNotFound (No Auto-Create)",
        passed,
        details: `Location: ${location}, Session issued: ${Boolean(cookies.session)}`,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // Clean up test users from isolated DB
  await pool.query(
    `DELETE FROM users WHERE LOWER(TRIM(email)) IN ($1, $2, $3) OR LOWER(TRIM(nik)) IN ($4, $5, $6, 'sso_ambig_nik_b')`,
    [
      testSsoActiveEmail.toLowerCase(),
      testSsoInactiveEmail.toLowerCase(),
      testAmbiguousEmail.toLowerCase(),
      testSsoActiveNik.toLowerCase(),
      testSsoInactiveNik.toLowerCase(),
      testAmbiguousNik.toLowerCase(),
    ]
  );

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
  console.error("SSO Callback test failed:", err);
  process.exit(1);
});

