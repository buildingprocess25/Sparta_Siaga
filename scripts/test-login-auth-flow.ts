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

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA - AUTHENTICATION & DEMO LOGIN TDD SUITE");
  console.log(" Target: sparta_siaga_isolated");
  console.log("================================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  // Dynamic import of route handlers
  const loginRoute = await import("../app/api/auth/login/route");
  const meRoute = await import("../app/api/auth/me/route");

  const devAdminPassword = process.env.DEV_ADMIN_PASSWORD || "admin123";
  const demoUserPassword = process.env.DEMO_USER_PASSWORD || "pass123";

  // TEST 1: Missing credentials -> 400
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "", password: "" }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    record(
      "Missing credentials returns 400",
      res.status === 400,
      `Status: ${res.status}, error: "${json.error}"`
    );
  }

  // TEST 2: Non-existent user -> 401
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "non_existent_user_9999", password: "anyPassword" }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    record(
      "Non-existent user returns 401",
      res.status === 401,
      `Status: ${res.status}, error: "${json.error}"`
    );
  }

  // TEST 3: Wrong password for existing user -> 401
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "ADM0001", password: "completely_wrong_password" }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    record(
      "Wrong password returns 401",
      res.status === 401,
      `Status: ${res.status}, error: "${json.error}"`
    );
  }

  // TEST 4: Inactive account returns 403 or 401
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "1001", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    record(
      "Inactive account is blocked (status 403)",
      res.status === 403,
      `Status: ${res.status}, error: "${json.error}"`
    );
  }

  // Helper to extract session cookie from response
  function extractCookie(res: Response): string | null {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/siaga_session=([^;]+)/);
    return match ? match[1] : null;
  }

  // TEST 5: Login with BMS using user ID "USR-BMS-001"
  let bmsCookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "USR-BMS-001", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    bmsCookie = extractCookie(res);
    record(
      "Login with BMS user ID 'USR-BMS-001'",
      res.status === 200 && Boolean(bmsCookie),
      `Status: ${res.status}, success: ${json.success}, cookie present: ${Boolean(bmsCookie)}`
    );
  }

  // TEST 6: GET /api/auth/me with BMS cookie resolves identity & permissions
  {
    if (bmsCookie) {
      const req = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${bmsCookie}` },
      });
      const res = await meRoute.GET(req as any);
      const json = await res.json();
      record(
        "GET /api/auth/me for BMS returns role=bms and branch",
        res.status === 200 && json.businessRole === "bms" && json.branch === "BANDUNG",
        `Status: ${res.status}, id: ${json.id}, role: ${json.businessRole}, branch: ${json.branch}`
      );
    } else {
      record("GET /api/auth/me for BMS returns role=bms and branch", false, "Skipped: no cookie from login");
    }
  }

  // TEST 7: Login with BMS using NIK "BMS0001"
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "BMS0001", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    const cookie = extractCookie(res);
    record(
      "Login with BMS NIK 'BMS0001'",
      res.status === 200 && Boolean(cookie),
      `Status: ${res.status}, cookie present: ${Boolean(cookie)}`
    );
  }

  // TEST 8: Login with BES using "USR-DEMO-BES" / "bes"
  let besCookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "bes", password: demoUserPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    besCookie = extractCookie(res);
    record(
      "Login with BES username 'bes'",
      res.status === 200 && Boolean(besCookie),
      `Status: ${res.status}, cookie present: ${Boolean(besCookie)}`
    );
  }

  // TEST 9: GET /api/auth/me for BES returns role=bes
  {
    if (besCookie) {
      const req = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${besCookie}` },
      });
      const res = await meRoute.GET(req as any);
      const json = await res.json();
      record(
        "GET /api/auth/me for BES returns role=bes and branch",
        res.status === 200 && json.businessRole === "bes" && json.branch === "BANDUNG",
        `Status: ${res.status}, id: ${json.id}, role: ${json.businessRole}, branch: ${json.branch}`
      );
    } else {
      record("GET /api/auth/me for BES returns role=bes and branch", false, "Skipped: no cookie from login");
    }
  }

  // TEST 10: Login with Admin using "admin" / "ADM0001"
  let adminCookie: string | null = null;
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "admin", password: devAdminPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    adminCookie = extractCookie(res);
    record(
      "Login with Admin username 'admin'",
      res.status === 200 && Boolean(adminCookie),
      `Status: ${res.status}, cookie present: ${Boolean(adminCookie)}`
    );
  }

  // TEST 11: GET /api/auth/me for Admin returns systemRole=ADMIN
  {
    if (adminCookie) {
      const req = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${adminCookie}` },
      });
      const res = await meRoute.GET(req as any);
      const json = await res.json();
      record(
        "GET /api/auth/me for Admin returns systemRole=ADMIN",
        res.status === 200 && json.systemRole === "ADMIN",
        `Status: ${res.status}, id: ${json.id}, sysRole: ${json.systemRole}`
      );
    } else {
      record("GET /api/auth/me for Admin returns systemRole=ADMIN", false, "Skipped: no cookie from login");
    }
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
