import { getDbPool, closeDbPool } from "../lib/db";
import { 
  ensureUserSessionsTable, 
  createDeviceSession, 
  rotateDeviceSession,
  hashToken
} from "../lib/session-service";
import { dbUpsertUser } from "../lib/user-db";
import { POST as refreshRoute } from "../app/api/auth/refresh/route";

async function reproduce() {
  console.log("===============================================================");
  console.log("SPARTA SIAGA: REPRODUCING AUTH RACE CONDITIONS & UNEXPECTED LOGOUT");
  console.log("===============================================================\n");

  const pool = getDbPool();
  await ensureUserSessionsTable();

  const testUserId = `repro_usr_${Date.now()}`;

  try {
    // 1. Create active test user
    await dbUpsertUser({
      id: testUserId,
      nik: `NIK_REPRO_${Date.now()}`,
      name: "Repro User",
      systemRole: "USER",
      businessRole: "bm",
      branch: "BANDUNG",
      scope: "BRANCH",
      status: "ACTIVE",
    });

    // 2. Create initial session
    const sessionRes = await createDeviceSession({
      userId: testUserId,
      userAgent: "Mozilla/5.0 Chrome/120.0",
      ipAddress: "127.0.0.1",
    });

    if (!sessionRes) throw new Error("Failed to create session");
    const token1 = sessionRes.refreshToken;
    console.log(`[Initial Session] Created with Token_1: ${token1.slice(0, 10)}...`);

    // -------------------------------------------------------------------------
    // TEST 1: Simultaneous parallel rotation calls at Database Level
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 1: Database-Level Parallel rotateDeviceSession ---");
    const [res1, res2] = await Promise.all([
      rotateDeviceSession(token1, { allowGracePeriod: true, userAgent: "Tab 1" }),
      rotateDeviceSession(token1, { allowGracePeriod: true, userAgent: "Tab 2" }),
    ]);

    console.log(`Call 1 returned refreshToken: ${res1?.refreshToken?.slice(0, 10)}... (is same as Token_1? ${res1?.refreshToken === token1})`);
    console.log(`Call 2 returned refreshToken: ${res2?.refreshToken?.slice(0, 10)}... (is same as Token_1? ${res2?.refreshToken === token1})`);

    const hasStaleTokenReturned = (res1?.refreshToken === token1) || (res2?.refreshToken === token1);
    if (hasStaleTokenReturned) {
      console.log("⚠️ [ROOT CAUSE CONFIRMED 1] One of the parallel calls returned the OLD, STALE Token_1!");
    }

    // -------------------------------------------------------------------------
    // TEST 2: HTTP Route /api/auth/refresh Cookie Overwrite Simulation
    // -------------------------------------------------------------------------
    console.log("\n--- TEST 2: HTTP Route /api/auth/refresh Concurrent Cookie Overwrite ---");
    // Create new session
    const httpSession = await createDeviceSession({
      userId: testUserId,
      userAgent: "Browser/1.0",
    });
    const httpToken1 = httpSession!.refreshToken;

    // Simulate 2 parallel calls to /api/auth/refresh with slight offset or parallel
    const reqA = new Request("http://localhost:3004/api/auth/refresh", {
      method: "POST",
      headers: { cookie: `siaga_refresh=${httpToken1}` },
    });
    const reqB = new Request("http://localhost:3004/api/auth/refresh", {
      method: "POST",
      headers: { cookie: `siaga_refresh=${httpToken1}` },
    });

    const [respA, respB] = await Promise.all([refreshRoute(reqA), refreshRoute(reqB)]);
    const setCookieA = respA.headers.get("set-cookie") || "";
    const setCookieB = respB.headers.get("set-cookie") || "";

    const matchRefreshA = setCookieA.match(/siaga_refresh=([^;]+)/);
    const matchRefreshB = setCookieB.match(/siaga_refresh=([^;]+)/);

    const tokenCookieA = matchRefreshA ? matchRefreshA[1] : null;
    const tokenCookieB = matchRefreshB ? matchRefreshB[1] : null;

    console.log(`Response A Set-Cookie siaga_refresh: ${tokenCookieA?.slice(0, 10)}... (matches httpToken1? ${tokenCookieA === httpToken1})`);
    console.log(`Response B Set-Cookie siaga_refresh: ${tokenCookieB?.slice(0, 10)}... (matches httpToken1? ${tokenCookieB === httpToken1})`);

    // Now test what happens after grace period if the browser kept the stale token!
    console.log("\n--- TEST 3: What happens when the browser sends the stale token after grace window? ---");
    // If browser saved the stale token:
    const staleToken = hasStaleTokenReturned ? token1 : httpToken1;
    
    // Check if the stale token can still be used right now:
    const immediateUse = await rotateDeviceSession(staleToken, { allowGracePeriod: true });
    console.log(`Using stale token during grace window: ${immediateUse ? "SUCCESS (temporary)" : "FAILED"}`);

    // Now simulate grace period expired (e.g. 31 seconds later):
    await pool.query(
      `UPDATE user_sessions SET previous_token_expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`,
      [testUserId]
    );

    const postGraceUse = await rotateDeviceSession(staleToken, { allowGracePeriod: true });
    console.log(`Using stale token AFTER grace window expires: ${postGraceUse ? "SUCCESS" : "FAILED (SESSION REVOKED / UNEXPECTED LOGOUT)"}`);

    if (!postGraceUse) {
      console.log("❌ [CONFIRMED REPRODUCTION] Browser using stale token gets 401 Unauthorized and forced logout!");
    }

  } finally {
    await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [testUserId]);
    await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    await closeDbPool();
  }
}

reproduce().catch(console.error);

