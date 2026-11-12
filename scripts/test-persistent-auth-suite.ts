import { getDbPool } from "../lib/db";
import { 
  ensureUserSessionsTable, 
  createDeviceSession, 
  rotateDeviceSession, 
  revokeSessionByRefreshToken, 
  revokeAllUserSessions,
  getUserActiveSessions,
  hashToken
} from "../lib/session-service";
import { 
  ACCESS_TOKEN_COOKIE, 
  REFRESH_TOKEN_COOKIE, 
  ACCESS_TOKEN_MAX_AGE, 
  REFRESH_TOKEN_MAX_AGE, 
  getAccessTokenCookieOptions, 
  getRefreshTokenCookieOptions 
} from "../lib/session-config";
import { signSession, verifySession } from "../lib/jwt";
import { getSessionUser } from "../lib/auth";
import { dbGetUserById, dbUpsertUser } from "../lib/user-db";
import { dispatchEarthquakePushNotifications, savePushSubscription } from "../lib/web-push-service";

async function runAuthSuite() {
  console.log("===============================================================");
  console.log("SPARTA SIAGA - AUTH-01: Persistent Login & PWA Session Suite");
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

  const testUserId = `test_auth_usr_${Date.now()}`;
  const testUserId2 = `test_auth_usr_dev2_${Date.now()}`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Database Schema & Migration for Persistent Sessions
    // -------------------------------------------------------------------------
    console.log("--- TEST GROUP 1: user_sessions Database Schema ---");
    await ensureUserSessionsTable();

    const colsRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_sessions'
    `);
    const cols = new Set(colsRes.rows.map((r: any) => r.column_name));

    assert(cols.has("id"), "Table user_sessions has id");
    assert(cols.has("user_id"), "Table user_sessions has user_id");
    assert(cols.has("refresh_token_hash"), "Table user_sessions has refresh_token_hash");
    assert(cols.has("device_type"), "Table user_sessions has device_type");
    assert(cols.has("user_agent"), "Table user_sessions has user_agent");
    assert(cols.has("ip_address"), "Table user_sessions has ip_address");
    assert(cols.has("token_version"), "Table user_sessions has token_version");
    assert(cols.has("is_revoked"), "Table user_sessions has is_revoked");
    assert(cols.has("expires_at"), "Table user_sessions has expires_at");

    // -------------------------------------------------------------------------
    // TEST 2: Cookie Security Options (HttpOnly, Secure, SameSite, MaxAge)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 2: Cookie Security Options & Lifetime ---");
    const accessOpts = getAccessTokenCookieOptions({ NODE_ENV: "production" } as any);
    const refreshOpts = getRefreshTokenCookieOptions({ NODE_ENV: "production" } as any);

    assert(accessOpts.httpOnly === true, "Access token cookie is HttpOnly (prevents XSS theft)");
    assert(accessOpts.secure === true, "Access token cookie is Secure in production (HTTPS only)");
    assert(accessOpts.sameSite === "lax", "Access token cookie SameSite is Lax (prevents CSRF)");
    assert(accessOpts.maxAge === 15 * 60, "Access token cookie maxAge is 15 minutes (short-lived)");

    assert(refreshOpts.httpOnly === true, "Refresh token cookie is HttpOnly (never in localStorage)");
    assert(refreshOpts.secure === true, "Refresh token cookie is Secure in production");
    assert(refreshOpts.sameSite === "lax", "Refresh token cookie SameSite is Lax");
    assert(refreshOpts.maxAge === 30 * 24 * 60 * 60, "Refresh token cookie maxAge is 30 days (persistent)");

    // -------------------------------------------------------------------------
    // TEST 3: Device Session Creation on Login
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 3: Per-Device Session Creation ---");
    // Seed test user
    await dbUpsertUser({
      id: testUserId,
      nik: `NIK_${Date.now()}`,
      name: "BMS Tester Persistent",
      systemRole: "USER",
      businessRole: "bms",
      branch: "SIDOARJO",
      scope: "BRANCH",
      status: "ACTIVE",
    });

    const androidUa = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
    const sessionRes = await createDeviceSession({
      userId: testUserId,
      userAgent: androidUa,
      ipAddress: "192.168.1.100",
    });

    assert(Boolean(sessionRes), "createDeviceSession succeeds for active user");
    assert(Boolean(sessionRes?.accessToken), "Returns signed access token");
    assert(Boolean(sessionRes?.refreshToken), "Returns raw refresh token for client cookie");
    assert(sessionRes?.refreshToken.length! >= 32, "Refresh token is cryptographically strong (>=32 chars)");

    const dbSession = await pool.query(`SELECT * FROM user_sessions WHERE id = $1`, [sessionRes?.sessionId]);
    assert(dbSession.rows.length === 1, "Session row created in user_sessions table");
    assert(dbSession.rows[0].device_type === "android", "Correctly identifies device_type as android");
    assert(dbSession.rows[0].refresh_token_hash === hashToken(sessionRes!.refreshToken), 
      "Stores SHA-256 hash of refresh token, not plain text (OWASP compliant)");

    // -------------------------------------------------------------------------
    // TEST 4: Transparent Session Verification & Refresh
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 4: Transparent Session Authentication & Renewal ---");
    // 4A: Valid access token authenticates immediately
    const validReq = new Request("http://localhost:3000/api/auth/me", {
      headers: {
        cookie: `${ACCESS_TOKEN_COOKIE}=${sessionRes!.accessToken}`,
      },
    });
    const userFromAccess = await getSessionUser(validReq);
    assert(Boolean(userFromAccess && userFromAccess.id === testUserId), 
      "Valid access token authenticates user without DB session check");

    // 4B: Expired access token with valid refresh token renews session seamlessly
    const expiredToken = await signSession({ id: testUserId, v: 1 }, "-10s"); // Expired 10 seconds ago
    const expiredReqWithRefresh = new Request("http://localhost:3000/api/auth/me", {
      headers: {
        cookie: `${ACCESS_TOKEN_COOKIE}=${expiredToken}; ${REFRESH_TOKEN_COOKIE}=${sessionRes!.refreshToken}`,
        "user-agent": androidUa,
      },
    });

    const userFromRefresh = await getSessionUser(expiredReqWithRefresh);
    assert(Boolean(userFromRefresh && userFromRefresh.id === testUserId), 
      "Expired access token automatically renews session via refresh token (Zero forced logout)");

    // -------------------------------------------------------------------------
    // TEST 5: Refresh Token Rotation (RTR) & Anti-Replay
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 5: Refresh Token Rotation (RTR) & Replay Prevention ---");
    // When session was rotated in 4B, the old refresh token was replaced.
    // Calling rotateDeviceSession with the OLD token must now FAIL!
    const replayAttempt = await rotateDeviceSession(sessionRes!.refreshToken);
    assert(replayAttempt === null, "Old refresh token cannot be reused after rotation (Anti-replay verified)");

    // Rotate with current token
    const currentSessionRow = await pool.query(`SELECT refresh_token_hash FROM user_sessions WHERE id = $1`, [sessionRes?.sessionId]);
    assert(currentSessionRow.rows[0].refresh_token_hash !== hashToken(sessionRes!.refreshToken), 
      "Database refresh_token_hash updated upon rotation");

    // -------------------------------------------------------------------------
    // TEST 6: Inactivity Clock Simulation (24-Hour, 7-Day, 30-Day)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 6: Inactivity Simulation (24h, 7d, 30d) ---");
    // Create fresh session for inactivity tests
    const inactSess = await createDeviceSession({
      userId: testUserId,
      userAgent: androidUa,
    });
    assert(Boolean(inactSess), "Created session for inactivity testing");

    // 6A: Simulate 24-Hour Inactivity (past 24h old cookie limit, within 30d)
    await pool.query(
      `UPDATE user_sessions 
       SET created_at = NOW() - INTERVAL '24 hours', last_used_at = NOW() - INTERVAL '24 hours' 
       WHERE id = $1`,
      [inactSess!.sessionId]
    );
    const renew24h = await rotateDeviceSession(inactSess!.refreshToken);
    assert(Boolean(renew24h), "24-hour inactivity: Session remains valid and rotates successfully (No daily logout)");

    // 6B: Simulate 7-Day Inactivity
    await pool.query(
      `UPDATE user_sessions 
       SET created_at = NOW() - INTERVAL '7 days', last_used_at = NOW() - INTERVAL '7 days' 
       WHERE id = $1`,
      [renew24h!.sessionId]
    );
    const renew7d = await rotateDeviceSession(renew24h!.refreshToken);
    assert(Boolean(renew7d), "7-day inactivity: Session remains valid and extends sliding window");

    // 6C: Simulate 31-Day Inactivity (beyond 30-day maximum lifetime)
    await pool.query(
      `UPDATE user_sessions 
       SET expires_at = NOW() - INTERVAL '1 hour' 
       WHERE id = $1`,
      [renew7d!.sessionId]
    );
    const renew31d = await rotateDeviceSession(renew7d!.refreshToken);
    assert(renew31d === null, "31-day inactivity (>30d): Expired session is correctly rejected");

    // -------------------------------------------------------------------------
    // TEST 7: Concurrent Multi-Device Sessions
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 7: Concurrent Per-Device Sessions ---");
    const desktopUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36";
    const dev1 = await createDeviceSession({ userId: testUserId, userAgent: androidUa });
    const dev2 = await createDeviceSession({ userId: testUserId, userAgent: desktopUa });

    assert(Boolean(dev1 && dev2 && dev1.sessionId !== dev2.sessionId), 
      "Creates distinct concurrent sessions for Android and Desktop");

    const activeSessions = await getUserActiveSessions(testUserId);
    assert(activeSessions.length >= 2, `Active sessions list returns both devices (Found: ${activeSessions.length})`);

    // Log out Device 1 only
    const unregDev1 = await revokeSessionByRefreshToken(dev1!.refreshToken);
    assert(unregDev1 === true, "Single-device logout revokes Device 1 session");

    // Device 2 must STILL be valid!
    const dev2Check = await rotateDeviceSession(dev2!.refreshToken);
    assert(Boolean(dev2Check), "Device 2 remains active and unaffected by Device 1 logout (Device isolation verified)");

    // -------------------------------------------------------------------------
    // TEST 8: Logout All Devices & Token Version Bump
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 8: Logout All Devices & Session Revocation ---");
    const dev3 = await createDeviceSession({ userId: testUserId, userAgent: desktopUa });
    assert(Boolean(dev3), "Created Device 3 session");

    // Logout all devices
    const newVersion = await revokeAllUserSessions(testUserId);
    assert(newVersion > 1, `Logout All Devices increments user token_version (New version: ${newVersion})`);

    // Attempting to renew Device 2 or Device 3 must be REJECTED
    const dev2Blocked = await rotateDeviceSession(dev2Check!.refreshToken);
    const dev3Blocked = await rotateDeviceSession(dev3!.refreshToken);
    assert(dev2Blocked === null && dev3Blocked === null, 
      "Logout All Devices immediately invalidates all active device refresh tokens");

    // -------------------------------------------------------------------------
    // TEST 9: Account Deactivation & Role Guards
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 9: Account Deactivation & Revocation ---");
    const deactUser = await dbUpsertUser({
      id: `usr_deact_${Date.now()}`,
      name: "Deactivated Staff",
      systemRole: "USER",
      status: "ACTIVE",
    });
    const deactSess = await createDeviceSession({ userId: deactUser.id });

    // Admin deactivates user
    await pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [deactUser.id]);

    const attemptAccessDeactivated = await getSessionUser(new Request("http://localhost:3000", {
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${deactSess!.accessToken}` },
    }));
    assert(attemptAccessDeactivated === null, "Deactivated user immediately denied on access token");

    const attemptRefreshDeactivated = await rotateDeviceSession(deactSess!.refreshToken);
    assert(attemptRefreshDeactivated === null, "Deactivated user immediately denied on refresh token");

    // -------------------------------------------------------------------------
    // TEST 10: Web Push Association & Inactive User Protection
    // -------------------------------------------------------------------------
    console.log("\n--- TEST GROUP 10: Web Push Association with Active User ---");
    const pushEndpoint = `https://fcm.googleapis.com/fcm/send/test_deact_push_${Date.now()}`;
    await savePushSubscription({
      userId: deactUser.id,
      branch: "SIDOARJO",
      endpoint: pushEndpoint,
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbVJaBoeWodhqqXdmooBj2i20ul-desMP2ZqMQEtuEI",
      auth: "tBHItJI5svbpez7KI4CCXg",
      userAgent: androidUa,
    });

    const pushDispatch = await dispatchEarthquakePushNotifications({
      title: "Test Alert",
      body: "Test Alert Body",
      branch: "SIDOARJO",
      eventId: `eq_deact_test_${Date.now()}`,
    });

    const targetedEndps = new Set(pushDispatch.outcomes.map(o => o.endpoint));
    assert(!targetedEndps.has(pushEndpoint), 
      "Push notification dispatch excludes inactive/revoked user subscriptions (Requirement 8 verified)");

    // Cleanup test data
    await pool.query(`DELETE FROM user_sessions WHERE user_id IN ($1, $2, $3)`, [testUserId, testUserId2, deactUser.id]);
    await pool.query(`DELETE FROM user_push_subscriptions WHERE endpoint = $1`, [pushEndpoint]);
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [testUserId, testUserId2, deactUser.id]);

    console.log("\n===============================================================");
    console.log(`AUTH-01 RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("===============================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Fatal error during persistent auth suite:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAuthSuite();
