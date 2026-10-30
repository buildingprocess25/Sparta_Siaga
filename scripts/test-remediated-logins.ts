import fs from "fs";
import path from "path";
import { getIsolatedDbPool, closeDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";

interface TestResult {
  role: string;
  identifier: string;
  expectedStatus: number;
  actualStatus: number;
  passed: boolean;
  userRole?: string;
  userName?: string;
  details?: string;
}

const results: TestResult[] = [];

function record(res: TestResult) {
  results.push(res);
  const statusStr = res.passed ? "PASS" : "FAIL";
  console.log(`[${statusStr}] ${res.role.padEnd(20)} | ID: ${res.identifier.padEnd(16)} | HTTP ${res.actualStatus} | ${res.details || ""}`);
}

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — POST-REMEDIATION AUTHENTICATION & MULTI-ROLE VERIFICATION");
  console.log(" Target: Aiven sparta_siaga_isolated");
  console.log("================================================================================\n");

  const pool = getIsolatedDbPool();
  await assertIsolatedDatabase(pool);

  // 1. Load credentials
  const pilotCredsPath = path.join(process.cwd(), ".env.pilot-credentials.local");
  const creds: Record<string, string> = {};
  if (fs.existsSync(pilotCredsPath)) {
    const lines = fs.readFileSync(pilotCredsPath, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([A-Z0-9_]+)=["']?([^"'\r\n]+)["']?/);
      if (match) creds[match[1]] = match[2].trim();
    }
  }

  const sysadminPassword = creds["PROD_SYSADMIN_PASSWORD"] || "";
  const hoAdminPassword = creds["PROD_HO_ADMIN_01_PASSWORD"] || "";
  const gmHoPassword = creds["PROD_GM_HO_PASSWORD"] || "";
  const demoPassword = process.env.DEMO_USER_PASSWORD || "pass123";

  // Dynamic import of routes
  const loginRoute = await import("../app/api/auth/login/route");
  const meRoute = await import("../app/api/auth/me/route");

  function extractCookie(res: Response): string | null {
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/siaga_session=([^;]+)/);
    return match ? match[1] : null;
  }

  // TEST 1: System Administrator with NIK "ADM0001"
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "ADM0001", password: sysadminPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    const cookie = extractCookie(res);
    let mePassed = false;
    let meName = "";
    if (cookie) {
      const meReq = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      });
      const meRes = await meRoute.GET(meReq as any);
      const meJson = await meRes.json();
      mePassed = meRes.status === 200 && meJson.systemRole === "ADMIN" && meJson.id === "usr_sysadmin_01";
      meName = meJson.name;
    }

    record({
      role: "System Administrator",
      identifier: "ADM0001",
      expectedStatus: 200,
      actualStatus: res.status,
      passed: res.status === 200 && mePassed,
      details: `Name: '${meName}', SystemRole: ADMIN, SessionCookie: ${Boolean(cookie)}`,
    });
  }

  // TEST 2: Inactive legacy admin with NIK "LEGACY_ADM0001" -> blocked (403)
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "LEGACY_ADM0001", password: sysadminPassword }),
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    record({
      role: "Legacy Seed Admin",
      identifier: "LEGACY_ADM0001",
      expectedStatus: 403,
      actualStatus: res.status,
      passed: res.status === 403,
      details: `Correctly blocked with: "${json.error}"`,
    });
  }

  // TEST 3: Head Office Admin (HO0001)
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "HO0001", password: hoAdminPassword }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    let mePassed = false;
    let details = "";
    if (cookie) {
      const meReq = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      });
      const meRes = await meRoute.GET(meReq as any);
      const meJson = await meRes.json();
      mePassed = meRes.status === 200 && meJson.businessRole === "ho_admin" && meJson.scope === "HO";
      details = `Name: '${meJson.name}', Role: '${meJson.businessRole}', Scope: '${meJson.scope}'`;
    }
    record({
      role: "HO Admin Monitoring",
      identifier: "HO0001",
      expectedStatus: 200,
      actualStatus: res.status,
      passed: res.status === 200 && mePassed,
      details,
    });
  }

  // TEST 4: General Manager Head Office (GM0001)
  {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "GM0001", password: gmHoPassword }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    let mePassed = false;
    let details = "";
    if (cookie) {
      const meReq = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      });
      const meRes = await meRoute.GET(meReq as any);
      const meJson = await meRes.json();
      mePassed = meRes.status === 200 && meJson.businessRole === "gm_ho" && meJson.scope === "HO";
      details = `Name: '${meJson.name}', Role: '${meJson.businessRole}', Scope: '${meJson.scope}'`;
    }
    record({
      role: "GM HO Monitoring",
      identifier: "GM0001",
      expectedStatus: 200,
      actualStatus: res.status,
      passed: res.status === 200 && mePassed,
      details,
    });
  }

  // TEST 5 - 11: Branch Personas (BMS, BMC, BES, BEC, BBS, BBC, BnM Manajer)
  const branchRoles = [
    { role: "BMS (Store Specialist)", id: "bms", expectedBizRole: "bms", expectedScope: "BRANCH" },
    { role: "BMC (Store Coord)", id: "bmc", expectedBizRole: "bmc", expectedScope: "BRANCH" },
    { role: "BES (DC Specialist)", id: "bes", expectedBizRole: "bes", expectedScope: "BRANCH" },
    { role: "BEC (DC Coord)", id: "bec", expectedBizRole: "bec", expectedScope: "BRANCH" },
    { role: "BBS (Office Spec)", id: "bbs", expectedBizRole: "bbs", expectedScope: "BRANCH" },
    { role: "BBC (Office Coord)", id: "bbc", expectedBizRole: "bbc", expectedScope: "BRANCH" },
    { role: "BnM Manajer", id: "bmm", expectedBizRole: "bm", expectedScope: "BRANCH" },
  ];

  for (const item of branchRoles) {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: item.id, password: demoPassword }),
    });
    const res = await loginRoute.POST(req);
    const cookie = extractCookie(res);
    let mePassed = false;
    let details = "";

    if (cookie) {
      const meReq = new Request("http://localhost/api/auth/me", {
        headers: { cookie: `siaga_session=${cookie}` },
      });
      const meRes = await meRoute.GET(meReq as any);
      const meJson = await meRes.json();
      mePassed = meRes.status === 200 && meJson.businessRole === item.expectedBizRole && meJson.scope === item.expectedScope;
      details = `Name: '${meJson.name}', Role: '${meJson.businessRole}', Scope: '${meJson.scope}', Branch: ${meJson.branch || "HO"}`;
    } else {
      const json = await res.json().catch(() => ({}));
      details = `Login failed: ${json.error || "No cookie"}`;
    }

    record({
      role: item.role,
      identifier: item.id,
      expectedStatus: 200,
      actualStatus: res.status,
      passed: res.status === 200 && mePassed,
      details,
    });
  }

  // TEST 12: Unique index verification in DB
  const idxRes = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'users' AND indexname = 'idx_users_unique_lower_nik'
  `);
  const indexExists = idxRes.rows.length === 1;
  record({
    role: "DB Unique Index",
    identifier: "idx_users_unique_lower_nik",
    expectedStatus: 1,
    actualStatus: idxRes.rows.length,
    passed: indexExists,
    details: indexExists ? idxRes.rows[0].indexdef : "Index not found",
  });

  // TEST 13: Zero remaining duplicate NIKs
  const dupRes = await pool.query(`
    SELECT LOWER(nik) as lower_nik, count(*) as c 
    FROM users 
    WHERE nik IS NOT NULL AND TRIM(nik) != '' 
    GROUP BY LOWER(nik) 
    HAVING count(*) > 1
  `);
  record({
    role: "Zero NIK Duplicates",
    identifier: "users.nik",
    expectedStatus: 0,
    actualStatus: dupRes.rows.length,
    passed: dupRes.rows.length === 0,
    details: dupRes.rows.length === 0 ? "Zero duplicate NIKs in users table" : `Duplicates found: ${JSON.stringify(dupRes.rows)}`,
  });

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
  console.error("Test execution failed:", err);
  process.exit(1);
});
