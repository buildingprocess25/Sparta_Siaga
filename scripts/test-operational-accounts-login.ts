import fs from "fs";
import path from "path";
import { POST as loginRoute } from "../app/api/auth/login/route";
import { GET as meRoute } from "../app/api/auth/me/route";
import { closeDbPool } from "../lib/db";

interface AccountExpectation {
  nik: string;
  envKey: string;
  expectedRole: string | null;
  expectedBranch: string | null;
  expectedSystemRole: "ADMIN" | "USER";
}

const TEST_ACCOUNTS: AccountExpectation[] = [
  // HO UAT Accounts
  { nik: "ADM0001", envKey: "PROD_SYSADMIN_PASSWORD", expectedRole: null, expectedBranch: null, expectedSystemRole: "ADMIN" },
  { nik: "HO0001", envKey: "PROD_HO_ADMIN_01_PASSWORD", expectedRole: "ho_admin", expectedBranch: null, expectedSystemRole: "USER" },
  { nik: "SM0001", envKey: "PROD_SM_HO_01_PASSWORD", expectedRole: "sm_ho", expectedBranch: null, expectedSystemRole: "USER" },
  { nik: "GM0001", envKey: "PROD_GM_HO_PASSWORD", expectedRole: "gm_ho", expectedBranch: null, expectedSystemRole: "USER" },

  // Operational Bandung Accounts
  { nik: "BMS0001", envKey: "UAT_BMS0001_PASSWORD", expectedRole: "bms", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },
  { nik: "BMC0001", envKey: "UAT_BMC0001_PASSWORD", expectedRole: "bmc", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },
  { nik: "BES0001", envKey: "UAT_BES0001_PASSWORD", expectedRole: "bes", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },
  { nik: "BEC0001", envKey: "UAT_BEC0001_PASSWORD", expectedRole: "bec", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },
  { nik: "BBS0001", envKey: "UAT_BBS0001_PASSWORD", expectedRole: "bbs", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },
  { nik: "BBC0001", envKey: "UAT_BBC0001_PASSWORD", expectedRole: "bbc", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },
  { nik: "BM0001", envKey: "UAT_BM0001_PASSWORD", expectedRole: "bm", expectedBranch: "BANDUNG", expectedSystemRole: "USER" },

  // Operational Cikokol Accounts
  { nik: "BMS0002", envKey: "UAT_BMS0002_PASSWORD", expectedRole: "bms", expectedBranch: "CIKOKOL", expectedSystemRole: "USER" },
  { nik: "BM0002", envKey: "UAT_BM0002_PASSWORD", expectedRole: "bm", expectedBranch: "CIKOKOL", expectedSystemRole: "USER" },
];

async function run() {
  console.log("================================================================================");
  console.log(" SPARTA SIAGA — UAT ACCOUNTS AUTHENTICATION & IDENTITY VERIFICATION");
  console.log("================================================================================\n");

  const credFilePath = path.join(process.cwd(), ".env.pilot-credentials.local");
  const credsContent = fs.readFileSync(credFilePath, "utf8");
  const creds: Record<string, string> = {};
  for (const line of credsContent.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*["']?([^"'\r\n]+)["']?\s*$/);
    if (match) creds[match[1]] = match[2];
  }

  let passed = 0;
  let failed = 0;

  for (const acc of TEST_ACCOUNTS) {
    const password = creds[acc.envKey];
    if (!password) {
      console.error(`❌ [FAIL] Missing password for ${acc.nik} (${acc.envKey}) in credentials file`);
      failed++;
      continue;
    }

    // 1. Login request
    const loginReq = new Request("http://localhost:3004/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: acc.nik, password }),
    });

    const loginRes = await loginRoute(loginReq);
    if (loginRes.status !== 200) {
      console.error(`❌ [FAIL] Login failed for ${acc.nik}: HTTP ${loginRes.status}`);
      failed++;
      continue;
    }

    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(/siaga_session=([^;]+)/);
    const sessionToken = sessionMatch ? sessionMatch[1] : null;

    if (!sessionToken) {
      console.error(`❌ [FAIL] No siaga_session cookie issued for ${acc.nik}`);
      failed++;
      continue;
    }

    // 2. Identity resolution via /api/auth/me
    const meReq = new Request("http://localhost:3004/api/auth/me", {
      headers: { cookie: `siaga_session=${sessionToken}` },
    });

    const meRes = await meRoute(meReq);
    if (meRes.status !== 200) {
      console.error(`❌ [FAIL] /api/auth/me failed for ${acc.nik}: HTTP ${meRes.status}`);
      failed++;
      continue;
    }

    const identity = await meRes.json();

    const roleMatches = acc.expectedRole === null ? identity.role === null : identity.role === acc.expectedRole;
    const branchMatches = acc.expectedBranch === null ? identity.branch === null : identity.branch === acc.expectedBranch;
    const systemRoleMatches = identity.systemRole === acc.expectedSystemRole;

    if (roleMatches && branchMatches && systemRoleMatches) {
      console.log(`✅ [PASS] ${acc.nik.padEnd(8)}: Authenticated as ${identity.name} [Role: ${identity.role || "ADMIN"}, Branch: ${identity.branch || "HO"}, Scope: ${identity.scope || "GLOBAL"}]`);
      passed++;
    } else {
      console.error(`❌ [FAIL] Identity mismatch for ${acc.nik}: Role=${identity.role} (exp ${acc.expectedRole}), Branch=${identity.branch} (exp ${acc.expectedBranch}), SysRole=${identity.systemRole}`);
      failed++;
    }
  }

  console.log("\n================================================================================");
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${TEST_ACCOUNTS.length})`);
  console.log("================================================================================");

  await closeDbPool();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
