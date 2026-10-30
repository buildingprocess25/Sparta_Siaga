import { getDbPool, closeDbPool } from "../lib/db";
import { 
  ensureUserSessionsTable, 
  createDeviceSession, 
  rotateDeviceSession,
  revokeSessionByRefreshToken,
  revokeAllUserSessions,
  getUserActiveSessions
} from "../lib/session-service";
import { dbUpsertUser } from "../lib/user-db";
import { POST as refreshRoute } from "../app/api/auth/refresh/route";
import { POST as logoutRoute } from "../app/api/auth/logout/route";
import { getSessionUser } from "../lib/auth";

async function runResilienceSuite() {
  console.log("===============================================================");
  console.log("SPARTA SIAGA: PERSISTENT AUTH & RESILIENCE VERIFICATION SUITE");
  console.log("===============================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  const pool = getDbPool();
  await ensureUserSessionsTable();

  const testUserId = `test_resilience_usr_${Date.now()}`;

  try {
    // 0. Seed test user
    await dbUpsertUser({
      id: testUserId,
      nik: `NIK_RES_${Date.now()}`,
      name: "Resilience Tester",
      systemRole: "USER",
      businessRole: "bms",
      branch: "BANDUNG",
      scope: "BRANCH",
      status: "ACTIVE",
    });

    // =========================================================================
    // SCENARIO 1: 10 Simultaneous Database-Level Rotations Return Identical Active Token
    // =========================================================================
    console.log("\n--- SCENARIO 1: 10 Parallel rotateDeviceSession Calls (No Stale Token Overwrite) ---");
    const session1 = await createDeviceSession({
      userId: testUserId,
      userAgent: "Desktop Chrome",
      ipAddress: "10.0.0.1",
    });
    assert(Boolean(session1), "Initial device session created");

    const token0 = session1!.refreshToken;

    // Fire 10 parallel rotation attempts using token0
    const parallelCalls = Array.from({ length: 10 }, (_, i) => 
      rotateDeviceSession(token0, {
        allowGracePeriod: true,
        userAgent: `Desktop Tab ${i + 1}`,
        ipAddress: "10.0.0.1",
      })
    );

    const results = await Promise.all(parallelCalls);
    const successfulResults = results.filter((r) => r !== null);

    assert(
      successfulResults.length === 10,
      "All 10 parallel rotation requests succeeded (10/10)",
      `Only ${successfulResults.length} succeeded`
    );

    // CRITICAL: All 10 must return the exact same active refresh token
    const firstRefreshToken = successfulResults[0]!.refreshToken;
    const allTokensMatch = successfulResults.every((r) => r!.refreshToken === firstRefreshToken);
    const noneMatchOldToken = successfulResults.every((r) => r!.refreshToken !== token0);

    assert(
      allTokensMatch,
      "All 10 parallel requests returned the exact same active refresh token (no desync)"
    );
    assert(
      noneMatchOldToken,
      "None of the 10 parallel requests returned the stale initial token"
    );

    // Verify database row state
    const dbRowCheck = await pool.query(
      `SELECT id, is_revoked, previous_refresh_token_hash FROM user_sessions WHERE id = $1`,
      [session1!.sessionId]
    );
    assert(
      dbRowCheck.rows.length === 1 && !dbRowCheck.rows[0].is_revoked,
      "Database session row remains active and not erroneously revoked"
    );

    // =========================================================================
    // SCENARIO 2: Multi-Device Isolation (Mobile vs. Desktop)
    // =========================================================================
    console.log("\n--- SCENARIO 2: Multi-Device Session Isolation (No Mutual Invalidation) ---");
    
    // Create Desktop session
    const desktopSession = await createDeviceSession({
      userId: testUserId,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
      ipAddress: "10.0.0.10",
    });

    // Create Mobile session
    const mobileSession = await createDeviceSession({
      userId: testUserId,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ipAddress: "10.0.0.20",
    });

    assert(Boolean(desktopSession && mobileSession), "Both Desktop and Mobile sessions created");

    let desktopToken = desktopSession!.refreshToken;
    let mobileToken = mobileSession!.refreshToken;

    // Rotate desktop session 3 times sequentially
    for (let i = 1; i <= 3; i++) {
      const rot = await rotateDeviceSession(desktopToken, { allowGracePeriod: true });
      assert(Boolean(rot), `Desktop rotation ${i} succeeded`);
      desktopToken = rot!.refreshToken;
    }

    // Verify Mobile session is untouched and valid
    const mobileUserCtx = await getSessionUser(new Request("http://localhost:3004/api/incidents", {
      headers: { cookie: `siaga_refresh=${mobileToken}` },
    }));
    assert(
      Boolean(mobileUserCtx && mobileUserCtx.id === testUserId),
      "Mobile session remains valid after 3 Desktop rotations"
    );

    // Rotate Mobile session
    const mobileRot = await rotateDeviceSession(mobileToken, { allowGracePeriod: true });
    assert(Boolean(mobileRot), "Mobile rotation succeeded independently");
    mobileToken = mobileRot!.refreshToken;

    // Verify Desktop session is still valid
    const desktopUserCtx = await getSessionUser(new Request("http://localhost:3004/api/incidents", {
      headers: { cookie: `siaga_refresh=${desktopToken}` },
    }));
    assert(
      Boolean(desktopUserCtx && desktopUserCtx.id === testUserId),
      "Desktop session remains valid after Mobile rotation"
    );

    // Active session count in database should be at least 2
    const activeSessions = await getUserActiveSessions(testUserId);
    assert(
      activeSessions.length >= 2,
      `User currently has ${activeSessions.length} active independent device sessions`
    );

    // =========================================================================
    // SCENARIO 3: Intentional Single-Device Logout vs Admin Revoke All
    // =========================================================================
    console.log("\n--- SCENARIO 3: Single-Device Logout vs Admin Revoke All ---");

    // Single-device logout on Mobile: only mobile is revoked
    const mobileLogoutReq = new Request("http://localhost:3004/api/auth/logout", {
      method: "POST",
      headers: { cookie: `siaga_refresh=${mobileToken}` },
    });
    const mobileLogoutRes = await logoutRoute(mobileLogoutReq);
    assert(mobileLogoutRes.status === 200, "Mobile single-device logout endpoint returned HTTP 200");

    // Mobile should now fail
    const mobileCheckAfterLogout = await rotateDeviceSession(mobileToken, { allowGracePeriod: true });
    assert(mobileCheckAfterLogout === null, "Mobile refresh token is revoked after single logout");

    // Desktop MUST still be valid!
    const desktopCheckAfterMobileLogout = await rotateDeviceSession(desktopToken, { allowGracePeriod: true });
    assert(
      Boolean(desktopCheckAfterMobileLogout),
      "Desktop session is NOT affected by Mobile device logout"
    );
    desktopToken = desktopCheckAfterMobileLogout!.refreshToken;

    // Admin Revoke All: revokes all user sessions
    await revokeAllUserSessions(testUserId);
    const desktopAfterAdminRevoke = await rotateDeviceSession(desktopToken, { allowGracePeriod: true });
    assert(
      desktopAfterAdminRevoke === null,
      "Desktop session is revoked when revokeAllUserSessions is executed"
    );

    // =========================================================================
    // SCENARIO 4: Grace Period Window & Stale Token Outside Window (RFC 6749)
    // =========================================================================
    console.log("\n--- SCENARIO 4: Grace Period Security & Token Reuse Detection ---");

    const reuseSession = await createDeviceSession({
      userId: testUserId,
      userAgent: "Security Probe",
      ipAddress: "10.0.0.99",
    });
    const reuseToken1 = reuseSession!.refreshToken;

    // Rotate once -> generates reuseToken2
    const rotRes1 = await rotateDeviceSession(reuseToken1, { allowGracePeriod: true });
    const reuseToken2 = rotRes1!.refreshToken;

    // Token 1 within grace period returns active token
    const graceAttempt = await rotateDeviceSession(reuseToken1, { allowGracePeriod: true });
    assert(
      Boolean(graceAttempt && graceAttempt.refreshToken === reuseToken2),
      "Token 1 within grace window successfully returns active Token 2"
    );

    // Simulate grace period expiry (past 60s)
    await pool.query(
      `UPDATE user_sessions 
       SET previous_token_expires_at = NOW() - INTERVAL '5 seconds' 
       WHERE id = $1`,
      [reuseSession!.sessionId]
    );

    // Attempt using Token 1 after grace expired -> must be rejected and revoke session family
    const staleAttempt = await rotateDeviceSession(reuseToken1, { allowGracePeriod: true });
    assert(
      staleAttempt === null,
      "Token 1 used after grace window expires is rejected"
    );

    // The whole session family should now be revoked (Token 2 also invalid)
    const token2Check = await rotateDeviceSession(reuseToken2, { allowGracePeriod: true });
    assert(
      token2Check === null,
      "Session family was revoked following stale token reuse outside grace window"
    );

    // =========================================================================
    // SCENARIO 5: HTTP Route /api/auth/refresh Cookie Security Options
    // =========================================================================
    console.log("\n--- SCENARIO 5: HTTP Route /api/auth/refresh Cookie Protections ---");

    const httpCookieSession = await createDeviceSession({
      userId: testUserId,
      userAgent: "Browser Security Test",
    });
    const httpToken = httpCookieSession!.refreshToken;

    const httpReq = new Request("http://localhost:3004/api/auth/refresh", {
      method: "POST",
      headers: {
        cookie: `siaga_refresh=${httpToken}`,
        "user-agent": "Browser/1.0",
      },
    });

    const httpRes = await refreshRoute(httpReq);
    assert(httpRes.status === 200, "HTTP refresh route returned 200 OK");

    const setCookieHeaders = httpRes.headers.getSetCookie();
    assert(setCookieHeaders.length >= 2, "Response contains Set-Cookie headers for access & refresh tokens");

    const refreshCookieHeader = setCookieHeaders.find((h) => h.includes("siaga_refresh="));
    assert(
      Boolean(refreshCookieHeader && refreshCookieHeader.toLowerCase().includes("httponly")),
      "siaga_refresh cookie includes HttpOnly protection"
    );
    assert(
      Boolean(refreshCookieHeader && refreshCookieHeader.toLowerCase().includes("path=/")),
      "siaga_refresh cookie includes Path=/"
    );

    // =========================================================================
    // SCENARIO 6: Account Inactivation Immediate Termination
    // =========================================================================
    console.log("\n--- SCENARIO 6: Inactive User Status Denies Session Immediately ---");

    const activeSessionBeforeDeact = await createDeviceSession({
      userId: testUserId,
      userAgent: "Deactivation Test",
    });
    const deactToken = activeSessionBeforeDeact!.refreshToken;

    // Deactivate user in database
    await pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [testUserId]);

    const attemptAfterDeact = await rotateDeviceSession(deactToken, { allowGracePeriod: true });
    assert(
      attemptAfterDeact === null,
      "Inactive user is rejected upon session rotation"
    );

    const authCtxAfterDeact = await getSessionUser(new Request("http://localhost:3004/api/incidents", {
      headers: { cookie: `siaga_refresh=${deactToken}` },
    }));
    assert(
      authCtxAfterDeact === null,
      "Inactive user getSessionUser returns null context"
    );

    console.log("\n===============================================================");
    console.log(`PERSISTENT AUTH RESILIENCE SUITE: ${passed} PASSED, ${failed} FAILED`);
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

runResilienceSuite()
  .then(async () => {
    await closeDbPool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Test failed:", err);
    await closeDbPool();
    process.exit(1);
  });

