import { getDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
  console.log(`[${passed ? "PASS" : "FAIL"}] ${name}`);
  console.log(`       Detail: ${details}\n`);
}

function extractCookie(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = setCookie.match(/siaga_session=([^;]+)/);
  return match ? match[1] : null;
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - TASK T11: MULTI-DEVICE AUTHENTICATION & REVOCATION TEST");
  console.log(" Target: sparta_siaga_isolated");
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  // Dynamic import of route handlers
  const loginRoute = await import("../app/api/auth/login/route");
  const meRoute = await import("../app/api/auth/me/route");
  const logoutRoute = await import("../app/api/auth/logout/route");
  const { seedDemoPersonas } = await import("./seed-demo-personas");
  await seedDemoPersonas();

  const demoUserPassword = process.env.DEMO_USER_PASSWORD || "pass123";

  // Reset token_version of USR-DEMO-BES to 1 and status to ACTIVE
  await pool.query(`UPDATE users SET token_version = 1, status = 'ACTIVE' WHERE id = 'USR-DEMO-BES'`);

  // SCENARIO 1: Device 1 (e.g. Laptop Kantor) logs in as BES
  let device1Cookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    device1Cookie = extractCookie(res);
    record(
      "Device 1 (Laptop) login as BES succeeds",
      res.status === 200 && Boolean(device1Cookie),
      `Status: ${res.status}, cookie present: ${Boolean(device1Cookie)}`
    );
  }

  // SCENARIO 2: Device 2 (e.g. Smartphone Petugas) logs in as the SAME BES account
  let device2Cookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    device2Cookie = extractCookie(res);
    record(
      "Device 2 (Smartphone) login as same BES succeeds concurrently",
      res.status === 200 && Boolean(device2Cookie),
      `Status: ${res.status}, cookie present: ${Boolean(device2Cookie)}`
    );
  }

  // SCENARIO 3: Device 3 (e.g. Tablet Inspeksi) logs in as the SAME BES account
  let device3Cookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    device3Cookie = extractCookie(res);
    record(
      "Device 3 (Tablet) login as same BES succeeds concurrently",
      res.status === 200 && Boolean(device3Cookie),
      `Status: ${res.status}, cookie present: ${Boolean(device3Cookie)}`
    );
  }

  // SCENARIO 4: All 3 devices query /api/auth/me simultaneously and resolve identical role & branch
  {
    const req1 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device1Cookie}` } });
    const req2 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device2Cookie}` } });
    const req3 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device3Cookie}` } });

    const [res1, res2, res3] = await Promise.all([
      meRoute.GET(req1 as any),
      meRoute.GET(req2 as any),
      meRoute.GET(req3 as any),
    ]);

    const json1 = await res1.json();
    const json2 = await res2.json();
    const json3 = await res3.json();

    const allActive =
      res1.status === 200 &&
      res2.status === 200 &&
      res3.status === 200 &&
      json1.businessRole === "bes" &&
      json2.businessRole === "bes" &&
      json3.businessRole === "bes" &&
      json1.branch === "BANDUNG" &&
      json2.branch === "BANDUNG" &&
      json3.branch === "BANDUNG";

    record(
      "All 3 devices are simultaneously active with valid role & branch",
      allActive,
      `D1 status: ${res1.status} (role=${json1.businessRole}), D2 status: ${res2.status} (role=${json2.businessRole}), D3 status: ${res3.status} (role=${json3.businessRole})`
    );
  }

  // SCENARIO 5: Device 1 logs out (single-device logout)
  {
    const req = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: `siaga_session=${device1Cookie}` },
    });
    const res = await logoutRoute.POST(req);
    const json = await res.json();
    const setCookie = res.headers.get("set-cookie") || "";
    const isCleared = setCookie.includes("Max-Age=0") || setCookie.includes("expires=");
    record(
      "Device 1 logs out (single-device logout)",
      res.status === 200 && json.success === true && isCleared,
      `Status: ${res.status}, success: ${json.success}, cookie cleared: ${isCleared}`
    );
  }

  // SCENARIO 6: Device 2 and Device 3 REMAIN ACTIVE after Device 1 logged out
  {
    const req2 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device2Cookie}` } });
    const req3 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device3Cookie}` } });

    const [res2, res3] = await Promise.all([
      meRoute.GET(req2 as any),
      meRoute.GET(req3 as any),
    ]);

    const json2 = await res2.json();
    const json3 = await res3.json();

    const stillActive =
      res2.status === 200 &&
      res3.status === 200 &&
      json2.businessRole === "bes" &&
      json3.businessRole === "bes";

    record(
      "Device 2 & 3 remain active without disruption after Device 1 logout",
      stillActive,
      `D2 status: ${res2.status} (active), D3 status: ${res3.status} (active)`
    );
  }

  // SCENARIO 7: Device 1 logs back in without affecting Device 2 and Device 3
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    device1Cookie = extractCookie(res);

    const checkMeReq = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device1Cookie}` } });
    const checkMeRes = await meRoute.GET(checkMeReq as any);

    record(
      "Device 1 can re-login successfully while others remain active",
      res.status === 200 && checkMeRes.status === 200,
      `Login status: ${res.status}, me status: ${checkMeRes.status}`
    );
  }

  // SCENARIO 8: Account deactivated in DB -> instantly blocked across ALL devices
  {
    await pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = 'USR-DEMO-BES'`);

    const req1 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device1Cookie}` } });
    const req2 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device2Cookie}` } });
    const req3 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device3Cookie}` } });

    const [res1, res2, res3] = await Promise.all([
      meRoute.GET(req1 as any),
      meRoute.GET(req2 as any),
      meRoute.GET(req3 as any),
    ]);

    const allRejected = res1.status === 401 && res2.status === 401 && res3.status === 401;

    record(
      "Deactivated account is instantly rejected across ALL devices",
      allRejected,
      `D1: ${res1.status}, D2: ${res2.status}, D3: ${res3.status} (all 401)`
    );

    // Restore to ACTIVE for remaining tests
    await pool.query(`UPDATE users SET status = 'ACTIVE' WHERE id = 'USR-DEMO-BES'`);
  }

  // SCENARIO 9: All-devices logout ('?all=true') revokes all active sessions via token_version
  {
    // Re-issue fresh sessions for Device 1 and Device 2
    const reqLogin1 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const resLogin1 = await loginRoute.POST(reqLogin1);
    device1Cookie = extractCookie(resLogin1);

    const reqLogin2 = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const resLogin2 = await loginRoute.POST(reqLogin2);
    device2Cookie = extractCookie(resLogin2);

    // Call logout with ?all=true using Device 1
    const reqLogoutAll = new Request("http://localhost/api/auth/logout?all=true", {
      method: "POST",
      headers: { cookie: `siaga_session=${device1Cookie}` },
    });
    const resLogoutAll = await logoutRoute.POST(reqLogoutAll);
    const jsonLogoutAll = await resLogoutAll.json();

    // Now test Device 2's previous session on /api/auth/me
    const reqCheck2 = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${device2Cookie}` } });
    const resCheck2 = await meRoute.GET(reqCheck2 as any);

    const allRevoked = jsonLogoutAll.allDevices === true && resCheck2.status === 401;

    record(
      "All-devices logout revokes sessions across all devices",
      allRevoked,
      `Logout response allDevices: ${jsonLogoutAll.allDevices}, Device 2 auth/me status: ${resCheck2.status} (401 expected)`
    );
  }

  // SCENARIO 10: New login after all-devices logout succeeds with bumped token_version
  {
    const reqNewLogin = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const resNewLogin = await loginRoute.POST(reqNewLogin);
    const newCookie = extractCookie(resNewLogin);

    const reqNewMe = new Request("http://localhost/api/auth/me", { headers: { cookie: `siaga_session=${newCookie}` } });
    const resNewMe = await meRoute.GET(reqNewMe as any);
    const jsonNewMe = await resNewMe.json();

    record(
      "New login after all-devices logout succeeds with updated token_version",
      resNewLogin.status === 200 && resNewMe.status === 200 && jsonNewMe.businessRole === "bes",
      `New login status: ${resNewLogin.status}, me status: ${resNewMe.status}, role: ${jsonNewMe.businessRole}`
    );
  }

  await closeDbPool();

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  console.log("================================================================================");
  console.log(`TOTAL: ${results.length} | PASS: ${passedCount} | FAIL: ${failedCount}`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

run().catch(async (e) => {
  console.error("Test execution failed:", e);
  await closeDbPool();
  process.exit(1);
});
