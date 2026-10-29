import { getDbPool, closeDbPool } from "../lib/db";
import { 
  ensureUserSessionsTable, 
  createDeviceSession, 
  rotateDeviceSession,
  hashToken
} from "../lib/session-service";
import { dbUpsertUser } from "../lib/user-db";
import { POST as refreshRoute } from "../app/api/auth/refresh/route";

async function runRaceConditionSuite() {
  console.log("===============================================================");
  console.log("SPARTA SIAGA — AUTH-02: Refresh Token Race Condition Test Suite");
  console.log("===============================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  const pool = getDbPool();
  await ensureUserSessionsTable();

  const testUserId = `test_race_usr_${Date.now()}`;

  try {
    // Seed test user
    await dbUpsertUser({
      id: testUserId,
      nik: `NIK_RACE_${Date.now()}`,
      name: "Race Condition Tester",
      systemRole: "USER",
      businessRole: "bms",
      branch: "BANDUNG",
      scope: "BRANCH",
      status: "ACTIVE",
    });

    // Create session
    const sessionRes = await createDeviceSession({
      userId: testUserId,
      userAgent: "Mozilla/5.0 Chrome/120.0 (Tab A)",
      ipAddress: "192.168.1.50",
    });

    assert(Boolean(sessionRes), "Session created successfully for race test");
    const initialRefreshToken = sessionRes!.refreshToken;

    // -------------------------------------------------------------------------
    // TEST 1: Simultaneous parallel rotation calls (Database Level Race Condition)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 1: Parallel rotateDeviceSession Calls (Same Token) ---");

    const [resA, resB] = await Promise.all([
      rotateDeviceSession(initialRefreshToken, { allowGracePeriod: true, userAgent: "Tab 1" }),
      rotateDeviceSession(initialRefreshToken, { allowGracePeriod: true, userAgent: "Tab 2" }),
    ]);

    assert(Boolean(resA), "Request 1 in race succeeds");
    assert(Boolean(resB), "Request 2 in race succeeds within grace window");
    assert(Boolean(resA?.accessToken && resB?.accessToken), "Both requests receive signed access tokens");
    assert(resA?.user.id === testUserId && resB?.user.id === testUserId, "Both requests identify the same user");

    // -------------------------------------------------------------------------
    // TEST 2: HTTP Route Deduplication (/api/auth/refresh Single-Flight)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 2: HTTP Route /api/auth/refresh Parallel Requests ---");

    // Create a new session for HTTP test
    const httpSession = await createDeviceSession({
      userId: testUserId,
      userAgent: "Mozilla/5.0 Mobile",
    });

    const httpRefreshToken = httpSession!.refreshToken;

    // Simulate 5 parallel calls to /api/auth/refresh with the same cookie
    const makeRefreshRequest = () => {
      const req = new Request("http://localhost:3004/api/auth/refresh", {
        method: "POST",
        headers: {
          cookie: `siaga_refresh=${httpRefreshToken}`,
          "user-agent": "Browser/1.0",
        },
      });
      return refreshRoute(req);
    };

    const httpResponses = await Promise.all([
      makeRefreshRequest(),
      makeRefreshRequest(),
      makeRefreshRequest(),
      makeRefreshRequest(),
      makeRefreshRequest(),
    ]);

    const statuses = httpResponses.map((r) => r.status);
    const jsonPromises = await Promise.all(httpResponses.map((r) => r.json()));

    assert(
      statuses.every((s) => s === 200),
      "All 5 parallel /api/auth/refresh requests return HTTP 200",
      `Received statuses: ${statuses.join(", ")}`
    );

    assert(
      jsonPromises.every((j) => j.success === true && j.user?.id === testUserId),
      "All 5 parallel requests return valid authenticated user data",
      `User IDs: ${jsonPromises.map((j) => j.user?.id).join(", ")}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Expired Grace Period or Completely Stale Token
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 3: Stale Token Outside Grace Period is Rejected ---");

    // Manually expire previous_token_expires_at in database
    await pool.query(
      `UPDATE user_sessions 
       SET previous_token_expires_at = NOW() - INTERVAL '10 seconds' 
       WHERE id = $1`,
      [sessionRes!.sessionId]
    );

    const expiredGraceAttempt = await rotateDeviceSession(initialRefreshToken, {
      allowGracePeriod: true,
    });

    assert(
      expiredGraceAttempt === null,
      "Token used after grace window expires is rejected (Security guard verified)"
    );

    console.log("\n===============================================================");
    console.log(`RACE CONDITION SUITE: ${passed} PASSED, ${failed} FAILED`);
    console.log("===============================================================");
  } finally {
    // Cleanup test user and sessions
    await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [testUserId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runRaceConditionSuite()
  .then(async () => {
    await closeDbPool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await closeDbPool();
    process.exit(1);
  });
