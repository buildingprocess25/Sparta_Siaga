import { getDbPool } from "../lib/db";
import {
  matchSsoIdentityToSiagaUser,
  validateSsoModuleAccess,
  isApprovedRoleAndBranch,
  SsoExchangeUser,
} from "../lib/sso-service";
import { checkUserPermission } from "../lib/permission-service";
import { canApproveAsBm, canInspectReport } from "../lib/report-permissions";
import { POST as loginPost } from "../app/api/auth/login/route";

async function runSsoMappingTest() {
  console.log("==================================================================");
  console.log("SPARTA SIAGA — TEST: SSO UAT IDENTITY MAPPING & RBAC VERIFICATION");
  console.log("==================================================================");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? ` -> ${detail}` : ""}`);
      failed++;
    }
  }

  const pool = getDbPool();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Verify SSO UAT Schema & Tables in Isolated Database
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 1: SSO UAT Schema & Tables in Isolated Database ---");
    const ssoTables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'sso_uat' 
      ORDER BY table_name;
    `);
    const tableNames = ssoTables.rows.map((r) => r.table_name);
    assert(
      tableNames.includes("User") && tableNames.includes("AppModule") && tableNames.includes("UserModuleAccess"),
      "Isolated SSO UAT schema (sso_uat) contains User, AppModule, and UserModuleAccess tables",
      `Found tables: ${tableNames.join(", ")}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Verify 11 UAT Personas Seeded in sso_uat with SIAGA Grant
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 2: 11 UAT Personas in sso_uat Database ---");
    const ssoUsers = await pool.query(`
      SELECT u.id, u.email, u."fullName" as name, u.role, b.code as branch_code, b.name as branch_name,
             EXISTS(
               SELECT 1 FROM sso_uat."UserModuleAccess" uma 
               WHERE uma."userId" = u.id AND uma."moduleId" = 'SIAGA' AND uma."isActive" = true
             ) as has_siaga_grant
      FROM sso_uat."User" u
      JOIN sso_uat."Branch" b ON u."branchId" = b.id
      ORDER BY u.email;
    `);

    assert(
      ssoUsers.rows.length === 11,
      `Exactly 11 UAT personas seeded in sso_uat database (found: ${ssoUsers.rows.length})`
    );

    const allHaveGrant = ssoUsers.rows.every((u) => u.has_siaga_grant);
    assert(allHaveGrant, "All 11 UAT personas in sso_uat have active 'SIAGA' module access grant");

    // -------------------------------------------------------------------------
    // TEST 3: Identity Matching against SIAGA Database
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 3: Identity Matching & Role Authorization in SIAGA ---");
    const personasToTest: Array<{
      email: string;
      expectedBusinessRole: string | null;
      expectedSystemRole: string;
      expectedScope: string | null;
      expectedBranch: string | null;
    }> = [
      {
        email: "sysadmin@sparta-siaga.local",
        expectedBusinessRole: "admin",
        expectedSystemRole: "ADMIN",
        expectedScope: "NASIONAL",
        expectedBranch: null,
      },
      {
        email: "budi.santoso@sparta-siaga.local",
        expectedBusinessRole: "admin",
        expectedSystemRole: "USER",
        expectedScope: "HO",
        expectedBranch: "HEAD OFFICE",
      },
      {
        email: "bm0001@sparta-siaga.local",
        expectedBusinessRole: "bm",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bms0001@sparta-siaga.local",
        expectedBusinessRole: "bms",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bes0001@sparta-siaga.local",
        expectedBusinessRole: "bes",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bmc0001@sparta-siaga.local",
        expectedBusinessRole: "bmc",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bec0001@sparta-siaga.local",
        expectedBusinessRole: "bec",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bbc0001@sparta-siaga.local",
        expectedBusinessRole: "bbc",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bbs0001@sparta-siaga.local",
        expectedBusinessRole: "bbs",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "BANDUNG",
      },
      {
        email: "bm0002@sparta-siaga.local",
        expectedBusinessRole: "bm",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "CIKOKOL",
      },
      {
        email: "bms0002@sparta-siaga.local",
        expectedBusinessRole: "bms",
        expectedSystemRole: "USER",
        expectedScope: "CABANG",
        expectedBranch: "CIKOKOL",
      },
    ];

    for (const p of personasToTest) {
      const ssoUserPayload: SsoExchangeUser = {
        email: p.email,
        fullName: p.email.split("@")[0].toUpperCase(),
        branch: p.expectedBranch || "HEAD OFFICE",
        access: ["siaga"],
      };

      // 1. Module access check
      assert(
        validateSsoModuleAccess(ssoUserPayload) === true,
        `SSO grant validated for '${p.email}' (access: ["siaga"])`
      );

      // 2. Identity match
      const match = await matchSsoIdentityToSiagaUser(ssoUserPayload);
      assert(
        match.status === "MATCHED",
        `SSO Identity '${p.email}' matches authentic SIAGA user (status: ${match.status})`
      );

      if (match.status === "MATCHED") {
        assert(
          match.user.status === "ACTIVE",
          `SIAGA user '${p.email}' status is ACTIVE`
        );
        assert(
          isApprovedRoleAndBranch(match.user) === true,
          `SIAGA user '${p.email}' satisfies isApprovedRoleAndBranch check`
        );
      }
    }

    // -------------------------------------------------------------------------
    // TEST 4: RBAC & Workflow Capability Verification via SSO-matched Users
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 4: Role Boundaries & Permissions via SSO ---");
    // BMS Bandung: Can inspect branch report
    const bmsMatch = await matchSsoIdentityToSiagaUser({
      email: "bms0001@sparta-siaga.local",
      access: ["siaga"],
    });
    if (bmsMatch.status === "MATCHED") {
      const bmsUserCtx = {
        id: bmsMatch.user.id,
        name: bmsMatch.user.name,
        role: bmsMatch.user.businessRole || "bms",
        systemRole: bmsMatch.user.systemRole,
        scope: bmsMatch.user.scope || "CABANG",
        branch: bmsMatch.user.branch || "BANDUNG",
      };
      const bmsReport: any = { id: "INC-UAT1-TOKO-001", branch: "BANDUNG", status: "verifying" };
      assert(
        canInspectReport(bmsUserCtx as any, bmsReport) === true,
        "BMS Bandung (authenticated via SSO) CAN inspect branch incident report"
      );
      assert(
        canApproveAsBm(bmsUserCtx as any, bmsReport) === false,
        "BMS Bandung (authenticated via SSO) CANNOT approve branch report as BM"
      );
    }

    // BnM Bandung: Can approve branch report
    const bmMatch = await matchSsoIdentityToSiagaUser({
      email: "bm0001@sparta-siaga.local",
      access: ["siaga"],
    });
    if (bmMatch.status === "MATCHED") {
      const bmUserCtx = {
        id: bmMatch.user.id,
        name: bmMatch.user.name,
        role: bmMatch.user.businessRole || "bm",
        systemRole: bmMatch.user.systemRole,
        scope: bmMatch.user.scope || "CABANG",
        branch: bmMatch.user.branch || "BANDUNG",
      };
      const bmReport: any = { id: "INC-UAT1-TOKO-001", branch: "BANDUNG", status: "verifying" };
      assert(
        canApproveAsBm(bmUserCtx as any, bmReport) === true,
        "BnM Bandung (authenticated via SSO) CAN approve branch incident report"
      );
    }

    // HO Admin: Can view all, create instruction, cannot approve
    const hoMatch = await matchSsoIdentityToSiagaUser({
      email: "budi.santoso@sparta-siaga.local",
      access: ["siaga"],
    });
    if (hoMatch.status === "MATCHED") {
      const hoUserCtx = {
        id: hoMatch.user.id,
        name: hoMatch.user.name,
        role: hoMatch.user.businessRole || "admin",
        systemRole: hoMatch.user.systemRole,
        scope: hoMatch.user.scope || "HO",
        branch: hoMatch.user.branch || "HEAD OFFICE",
      };
      const hoReport: any = { id: "INC-UAT1-TOKO-001", branch: "BANDUNG", status: "verifying" };
      const hoPerm = await checkUserPermission({
        user: hoUserCtx as any,
        permission: "MANAGEMENT_INSTRUCTION_CREATE",
      });
      assert(
        hoPerm.authorized === true,
        "HO Admin (authenticated via SSO) has MANAGEMENT_INSTRUCTION_CREATE permission",
        hoPerm.reason
      );
      assert(
        canApproveAsBm(hoUserCtx as any, hoReport) === false,
        "HO Admin (authenticated via SSO) CANNOT approve branch report"
      );
    }

    // -------------------------------------------------------------------------
    // TEST 5: Negative Testing — Unauthorized Module Access Rejection
    // -------------------------------------------------------------------------
    console.log("\n--- SECTION 5: Negative Security Guards ---");
    // User without 'siaga' access in SSO token
    const noSiagaPayload: SsoExchangeUser = {
      email: "bms0001@sparta-siaga.local",
      access: ["building", "maintenance"],
    };
    assert(
      validateSsoModuleAccess(noSiagaPayload) === false,
      "validateSsoModuleAccess rejects user without 'siaga' module grant"
    );

    // Direct password bypass attempt
    const bypassReq = new Request("http://localhost:3004/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: "bms0001@sparta-siaga.local",
        password: "anypassword",
      }),
    });
    const bypassRes = await loginPost(bypassReq);
    const bypassJson = await bypassRes.json();
    assert(
      bypassRes.status === 403 && bypassJson.code === "SSO_LOGIN_REQUIRED",
      "Direct login without SSO is blocked (HTTP 403 SSO_LOGIN_REQUIRED)"
    );

    // -------------------------------------------------------------------------
    // TEST 6: Summary
    // -------------------------------------------------------------------------
    console.log("\n==================================================================");
    console.log(`SSO MAPPING TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

runSsoMappingTest().catch((err) => {
  console.error("Test runner encountered an error:", err);
  process.exit(1);
});
