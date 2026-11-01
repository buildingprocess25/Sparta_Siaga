import { getDbPool } from "../lib/db";
import {
  checkUserPermission,
  createUserOverride,
  canConfirmReportAsync,
  updateRolePermissions,
} from "../lib/permission-service";
import { checkClientPermission } from "../lib/client-permissions";
import { IncidentRecord } from "../types/incident";
import * as fs from "fs";
import * as path from "path";

async function runTestSuiteAtoJ() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - VERIFICATION SUITE A TO J");
  console.log("==================================================\n");

  const pool = getDbPool();
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition: boolean, testCode: string, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] Test ${testCode}: ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] Test ${testCode}: ${testName} - Detail: ${detail || "Condition failed"}`);
      process.exitCode = 1;
    }
  }

  try {
    // Mock Incident Reports
    const reportG001: IncidentRecord = {
      id: "INC-TEST-G001",
      storeId: "STR-001",
      storeName: "Alfamart Cibubur",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 15,
      timeline: [],
    };

    const reportG002: IncidentRecord = {
      id: "INC-TEST-G002",
      storeId: "STR-002",
      storeName: "Alfamart Soekarno Hatta",
      branch: "G002",
      locationCity: "Bandung",
      disasterType: "earthquake",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "verifying",
      progress: 15,
      timeline: [],
    };

    // User Contexts
    const systemAdminUser = {
      id: "USR-ADMIN-DEV",
      name: "Admin SPARTA SIAGA",
      nik: "ADM0001",
      role: null,
      systemRole: "ADMIN" as const,
      scope: null,
      branch: null,
    };

    const bmG001User = {
      id: "USR-BM-G001",
      name: "Agus BM G001",
      nik: "BM0001",
      role: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const hoUser = {
      id: "USR-HO-BUDI",
      name: "Budi HO Admin",
      nik: "HO0001",
      role: "ho_admin" as const,
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: null,
    };

    // Ensure database records exist for foreign keys
    await pool.query(
      `INSERT INTO users (id, nik, name, email, system_role, business_role, scope, branch, status)
       VALUES 
       ('USR-HO-BUDI', 'HO0001', 'Budi HO Admin', 'budi@sparta.com', 'USER', 'ho_admin', 'HO', NULL, 'ACTIVE'),
       ('USR-BM-G001', 'BM0001', 'Agus BM G001', 'agus@sparta.com', 'USER', 'bm', 'BRANCH', 'G001', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET
         business_role = EXCLUDED.business_role,
         scope = EXCLUDED.scope,
         branch = EXCLUDED.branch`
    );

    // Clean overrides for test users
    await pool.query(`DELETE FROM user_permission_overrides WHERE user_id IN ('USR-HO-BUDI', 'USR-BM-G001', 'USR-ADMIN-DEV')`);

    // Reset default role permissions for bm and ho_admin
    await updateRolePermissions("bm", {
      REPORT_CONFIRM: "ALLOW",
      REPORT_FOLLOW_UP: "ALLOW",
      REPORT_CLOSE: "ALLOW",
    }, { id: systemAdminUser.id, name: systemAdminUser.name });

    await updateRolePermissions("ho_admin", {
      REPORT_VIEW_ALL: "ALLOW",
      NOTIFICATION_VIEW: "ALLOW",
      ESTIMATION_VIEW: "ALLOW",
    }, { id: systemAdminUser.id, name: systemAdminUser.name });

    function makeMockIdentity(data: any): import("../lib/identity").UserIdentity {
      return {
        id: data.id,
        userId: data.id,
        nik: data.nik || null,
        name: data.name,
        avatarUrl: null,
        systemRole: data.systemRole,
        businessRole: data.businessRole || null,
        scope: data.scope || null,
        branch: data.branch || null,
        role: data.businessRole || null,
        position: data.businessRole || "Staff",
        rolePermissions: data.rolePermissions,
        overrides: data.overrides,
      };
    }

    // -------------------------------------------------------------------------
    // TEST A: Branch Manager dengan REPORT_CONFIRM pada own branch (G001)
    // Expected: ALLOW / form terbuka
    // -------------------------------------------------------------------------
    const testAResult = await checkUserPermission({
      user: bmG001User,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const clientCheckA = checkClientPermission({
      identity: makeMockIdentity({
        id: bmG001User.id,
        nik: bmG001User.nik,
        name: bmG001User.name,
        systemRole: bmG001User.systemRole,
        businessRole: bmG001User.role,
        scope: bmG001User.scope,
        branch: bmG001User.branch,
        rolePermissions: { REPORT_CONFIRM: "ALLOW" },
      }),
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      testAResult.authorized === true && clientCheckA.authorized === true,
      "A",
      "Branch Manager dengan REPORT_CONFIRM pada own branch -> ALLOW (form konfirmasi terbuka)"
    );

    // -------------------------------------------------------------------------
    // TEST B: Branch Manager pada branch lain (G002)
    // Expected: DENY / blocked / 403
    // -------------------------------------------------------------------------
    const testBResult = await checkUserPermission({
      user: bmG001User,
      permission: "REPORT_CONFIRM",
      report: reportG002,
    });
    const clientCheckB = checkClientPermission({
      identity: makeMockIdentity({
        id: bmG001User.id,
        nik: bmG001User.nik,
        name: bmG001User.name,
        systemRole: bmG001User.systemRole,
        businessRole: bmG001User.role,
        scope: bmG001User.scope,
        branch: bmG001User.branch,
        rolePermissions: { REPORT_CONFIRM: "ALLOW" },
      }),
      permission: "REPORT_CONFIRM",
      report: reportG002,
    });
    assert(
      testBResult.authorized === false && clientCheckB.authorized === false,
      "B",
      "Branch Manager pada branch lain (G002) -> DENY / blocked",
      testBResult.reason
    );

    // -------------------------------------------------------------------------
    // TEST C: HO Admin default
    // Expected: DENY / blocked
    // -------------------------------------------------------------------------
    const testCResult = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const clientCheckC = checkClientPermission({
      identity: makeMockIdentity({
        id: hoUser.id,
        nik: hoUser.nik,
        name: hoUser.name,
        systemRole: hoUser.systemRole,
        businessRole: hoUser.role,
        scope: hoUser.scope,
        branch: hoUser.branch,
        rolePermissions: { REPORT_CONFIRM: "DENY" },
      }),
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      testCResult.authorized === false && clientCheckC.authorized === false,
      "C",
      "HO Admin default -> DENY / blocked",
      testCResult.reason
    );

    // -------------------------------------------------------------------------
    // TEST D: HO Admin dengan override REPORT_CONFIRM G001
    // Expected: G001 ALLOW (form terbuka)
    // -------------------------------------------------------------------------
    const expiresFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const ovrD = await createUserOverride({
      userId: hoUser.id,
      permissionKey: "REPORT_CONFIRM",
      effect: "ALLOW",
      scopeType: "SPECIFIC_BRANCH",
      branchCode: "G001",
      reason: "Penugasan darurat Verifikasi Banjir Cibubur",
      expiresAt: expiresFuture,
      actor: { id: systemAdminUser.id, name: systemAdminUser.name },
    });

    const testDResult = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const clientCheckD = checkClientPermission({
      identity: makeMockIdentity({
        id: hoUser.id,
        nik: hoUser.nik,
        name: hoUser.name,
        systemRole: hoUser.systemRole,
        businessRole: hoUser.role,
        scope: hoUser.scope,
        branch: hoUser.branch,
        rolePermissions: { REPORT_CONFIRM: "DENY" },
        overrides: [ovrD],
      }),
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      testDResult.authorized === true && clientCheckD.authorized === true,
      "D",
      "HO Admin dengan override REPORT_CONFIRM G001 -> G001 ALLOW (form konfirmasi terbuka)"
    );

    // -------------------------------------------------------------------------
    // TEST E: HO Admin override G001 tetapi buka G002
    // Expected: DENY / blocked
    // -------------------------------------------------------------------------
    const testEResult = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG002,
    });
    const clientCheckE = checkClientPermission({
      identity: makeMockIdentity({
        id: hoUser.id,
        nik: hoUser.nik,
        name: hoUser.name,
        systemRole: hoUser.systemRole,
        businessRole: hoUser.role,
        scope: hoUser.scope,
        branch: hoUser.branch,
        rolePermissions: { REPORT_CONFIRM: "DENY" },
        overrides: [ovrD],
      }),
      permission: "REPORT_CONFIRM",
      report: reportG002,
    });
    assert(
      testEResult.authorized === false && clientCheckE.authorized === false,
      "E",
      "HO Admin override G001 buka G002 -> DENY / blocked",
      testEResult.reason
    );

    // -------------------------------------------------------------------------
    // TEST F: Override expired
    // Expected: DENY / blocked
    // -------------------------------------------------------------------------
    // Set expired time in DB
    const expiredPast = new Date(Date.now() - 30 * 60 * 1000);
    await pool.query(
      `UPDATE user_permission_overrides SET expires_at = $1 WHERE id = $2`,
      [expiredPast, ovrD.id]
    );

    const testFResult = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const clientCheckF = checkClientPermission({
      identity: makeMockIdentity({
        id: hoUser.id,
        nik: hoUser.nik,
        name: hoUser.name,
        systemRole: hoUser.systemRole,
        businessRole: hoUser.role,
        scope: hoUser.scope,
        branch: hoUser.branch,
        rolePermissions: { REPORT_CONFIRM: "DENY" },
        overrides: [{ ...ovrD, expiresAt: expiredPast.toISOString() }],
      }),
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      testFResult.authorized === false && clientCheckF.authorized === false,
      "F",
      "Override expired -> DENY / blocked (kembali terkunci otomatis)",
      testFResult.reason
    );

    // -------------------------------------------------------------------------
    // TEST G: System Admin tanpa operational permission
    // Expected: DENY / blocked
    // -------------------------------------------------------------------------
    const testGResult = await checkUserPermission({
      user: systemAdminUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const clientCheckG = checkClientPermission({
      identity: makeMockIdentity({
        id: systemAdminUser.id,
        nik: systemAdminUser.nik,
        name: systemAdminUser.name,
        systemRole: systemAdminUser.systemRole,
        businessRole: null,
        scope: null,
        branch: null,
      }),
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      testGResult.authorized === false && clientCheckG.authorized === false,
      "G",
      "System Admin tanpa operational permission -> DENY / blocked",
      testGResult.reason
    );

    // -------------------------------------------------------------------------
    // TEST H: Role simulation text in normal production flow
    // Expected: Hidden / guarded by NEXT_PUBLIC_ENABLE_ROLE_SIMULATION === 'true'
    // -------------------------------------------------------------------------
    const appShellContent = fs.readFileSync(
      path.join(process.cwd(), "components/layout/incident-app-shell.tsx"),
      "utf-8"
    );
    const isRoleSimGuarded = appShellContent.includes('process.env.NEXT_PUBLIC_ENABLE_ROLE_SIMULATION === "true"');
    assert(
      isRoleSimGuarded,
      "H",
      "Role simulation text guarded by NEXT_PUBLIC_ENABLE_ROLE_SIMULATION (disabled in normal prod flow)"
    );

    // -------------------------------------------------------------------------
    // TEST I: "Tips Demo" text removed
    // Expected: 0 occurrences of "Tips Demo" in all component files
    // -------------------------------------------------------------------------
    const componentsDir = path.join(process.cwd(), "components");
    let hasTipsDemo = false;
    function scanDirForTipsDemo(dir: string) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDirForTipsDemo(fullPath);
        } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
          const content = fs.readFileSync(fullPath, "utf-8");
          if (content.toLowerCase().includes("tips demo")) {
            hasTipsDemo = true;
            console.error(`Found 'Tips Demo' in ${fullPath}`);
          }
        }
      }
    }
    scanDirForTipsDemo(componentsDir);
    assert(
      !hasTipsDemo,
      "I",
      "'Tips Demo' text completely removed from all frontend components (0 occurrences)"
    );

    // -------------------------------------------------------------------------
    // TEST J: Direct API confirm unauthorized -> 403
    // Expected: canConfirmReportAsync returns false for unauthorized user
    // -------------------------------------------------------------------------
    const directApiCheckUnauthorized = await canConfirmReportAsync(hoUser, reportG001);
    assert(
      directApiCheckUnauthorized === false,
      "J",
      "Direct API confirm unauthorized -> 403 (Protected by canConfirmReportAsync)"
    );

    console.log("\n==================================================");
    console.log(`TEST SUITE A–J RESULTS: ${passedCount} / ${totalTests} TESTS PASSED`);
    console.log("==================================================");

    if (passedCount !== totalTests) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runTestSuiteAtoJ();
