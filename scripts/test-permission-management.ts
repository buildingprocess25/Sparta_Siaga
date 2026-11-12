import { getDbPool } from "../lib/db";
import {
  checkUserPermission,
  getRolePermissions,
  updateRolePermissions,
  createUserOverride,
  revokeUserOverride,
  getPermissionAuditLogs,
  invalidateRolePermissionsCache,
  hasAdminCapability,
  canViewReportAsync,
  canConfirmReportAsync,
  canFollowUpReportAsync,
  canCloseReportAsync,
} from "../lib/permission-service";
import { IncidentRecord } from "../types/incident";

async function runTestSuite() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - SYSTEM ADMIN & ESTIMATION PERMISSIONS");
  console.log("==================================================\n");

  const pool = getDbPool();
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition: boolean, code: string, title: string, detail?: string) {
    totalTests++;
    if (condition) {
      console.log(`[PASS] Scenario ${code}: ${title}`);
      passedCount++;
    } else {
      console.error(`[FAIL] Scenario ${code}: ${title} - Detail: ${detail || "Condition not met"}`);
      process.exitCode = 1;
    }
  }

  try {
    // 0. Reports Mock
    const reportG001: IncidentRecord = {
      id: "INC-TEST-G001",
      storeId: "STR-001",
      storeName: "Alfamart Cibubur G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 30,
      timeline: [],
    };

    const reportG002: IncidentRecord = {
      id: "INC-TEST-G002",
      storeId: "STR-002",
      storeName: "Alfamart Bandung G002",
      branch: "G002",
      locationCity: "Bandung",
      disasterType: "earthquake",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "02 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 30,
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

    const hoUser = {
      id: "USR-HO-BUDI",
      name: "Budi HO Admin",
      nik: "HO0001",
      role: "ho_admin" as const,
      systemRole: "USER" as const,
      scope: "HO" as const,
      branch: null,
    };

    const bmUser1 = {
      id: "USR-BM-G001",
      name: "Agus BM G001",
      nik: "BM0001",
      role: "bm" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const spartaMaintUser = {
      id: "USR-MTC-001",
      name: "Dedi Sparta Maintenance",
      nik: "MTC0001",
      role: "sparta_maintenance" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    const bmsUser = {
      id: "USR-BMS-001",
      name: "Eko BMS G001",
      nik: "BMS0001",
      role: "bms" as const,
      systemRole: "USER" as const,
      scope: "BRANCH" as const,
      branch: "G001",
    };

    // Ensure users in DB
    await pool.query(
      `INSERT INTO users (id, nik, name, email, system_role, business_role, scope, branch, status)
       VALUES 
       ('USR-HO-BUDI', 'HO0001', 'Budi HO Admin', 'budi@sparta.com', 'USER', 'ho_admin', 'HO', NULL, 'ACTIVE'),
       ('USR-BM-G001', 'BM0001', 'Agus BM G001', 'agus@sparta.com', 'USER', 'bm', 'BRANCH', 'G001', 'ACTIVE'),
       ('USR-MTC-001', 'MTC0001', 'Dedi Maintenance', 'dedi@sparta.com', 'USER', 'sparta_maintenance', 'BRANCH', 'G001', 'ACTIVE'),
       ('USR-BMS-001', 'BMS0001', 'Eko BMS', 'eko@sparta.com', 'USER', 'bms', 'BRANCH', 'G001', 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET
         business_role = EXCLUDED.business_role,
         scope = EXCLUDED.scope,
         branch = EXCLUDED.branch`
    );

    // Clean user overrides
    await pool.query(`DELETE FROM user_permission_overrides WHERE user_id IN ('USR-HO-BUDI', 'USR-BM-G001', 'USR-MTC-001', 'USR-BMS-001', 'USR-ADMIN-DEV')`);

    // Invalidate cache
    invalidateRolePermissionsCache();

    // -------------------------------------------------------------------------
    // SCENARIO A: System Admin login -> Admin User/Role/Permission page allowed
    // -------------------------------------------------------------------------
    const canManageUsers = hasAdminCapability(systemAdminUser, "MANAGE_USERS");
    const canManageRoles = hasAdminCapability(systemAdminUser, "MANAGE_ROLES");
    const canManagePerms = hasAdminCapability(systemAdminUser, "MANAGE_PERMISSIONS");
    const canViewAudit = hasAdminCapability(systemAdminUser, "VIEW_AUDIT_LOG");
    assert(
      canManageUsers && canManageRoles && canManagePerms && canViewAudit,
      "A",
      "System Admin login -> Admin User/Role/Permission page allowed (Administrative capabilities)"
    );

    // -------------------------------------------------------------------------
    // SCENARIO B: System Admin melihat report -> allowed untuk monitoring/support
    // -------------------------------------------------------------------------
    const adminCanViewReport = await canViewReportAsync(systemAdminUser, reportG001);
    const adminCheckViewAll = await checkUserPermission({
      user: systemAdminUser,
      permission: "REPORT_VIEW_ALL",
      report: reportG001,
    });
    assert(
      adminCanViewReport === true && adminCheckViewAll.authorized === true,
      "B",
      "System Admin melihat report -> allowed untuk monitoring/support/audit"
    );

    // -------------------------------------------------------------------------
    // SCENARIO C: System Admin Confirm Report -> 403 / DENY
    // -------------------------------------------------------------------------
    const adminConfirm = await checkUserPermission({
      user: systemAdminUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      adminConfirm.authorized === false,
      "C",
      "System Admin Confirm Report -> 403 / DENIED (No operational bypass)",
      adminConfirm.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO D: System Admin Follow Up -> 403 / DENY
    // -------------------------------------------------------------------------
    const adminFollowUp = await checkUserPermission({
      user: systemAdminUser,
      permission: "REPORT_FOLLOW_UP",
      report: reportG001,
    });
    assert(
      adminFollowUp.authorized === false,
      "D",
      "System Admin Follow Up -> 403 / DENIED (No operational bypass)",
      adminFollowUp.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO E: System Admin Close Report -> 403 / DENY
    // -------------------------------------------------------------------------
    const adminClose = await checkUserPermission({
      user: systemAdminUser,
      permission: "REPORT_CLOSE",
      report: reportG001,
    });
    assert(
      adminClose.authorized === false,
      "E",
      "System Admin Close Report -> 403 / DENIED (No operational bypass)",
      adminClose.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO F: System Admin Trigger Estimation -> 403 / DENY
    // -------------------------------------------------------------------------
    const adminEstTrigger = await checkUserPermission({
      user: systemAdminUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportG001,
    });
    assert(
      adminEstTrigger.authorized === false,
      "F",
      "System Admin Trigger Estimation -> 403 / DENIED (No operational bypass)",
      adminEstTrigger.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO G: Branch Manager existing operational report permission
    // -------------------------------------------------------------------------
    const bmConfirm = await checkUserPermission({
      user: bmUser1,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const bmFollowUp = await checkUserPermission({
      user: bmUser1,
      permission: "REPORT_FOLLOW_UP",
      report: reportG001,
    });
    const bmClose = await checkUserPermission({
      user: bmUser1,
      permission: "REPORT_CLOSE",
      report: reportG001,
    });
    assert(
      bmConfirm.authorized === true && bmFollowUp.authorized === true && bmClose.authorized === true,
      "G",
      "Branch Manager operational report permission on own branch -> ALLOWED per Role Permission"
    );

    // -------------------------------------------------------------------------
    // SCENARIO H: Branch Manager ESTIMATION_TRIGGER -> DENY
    // -------------------------------------------------------------------------
    const bmEstTrigger = await checkUserPermission({
      user: bmUser1,
      permission: "ESTIMATION_TRIGGER",
      report: reportG001,
    });
    assert(
      bmEstTrigger.authorized === false,
      "H",
      "Branch Manager ESTIMATION_TRIGGER -> DENY (Koreksi requirement Pak Iqbal)",
      bmEstTrigger.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO I: Sparta Maintenance ESTIMATION_TRIGGER -> DENY
    // -------------------------------------------------------------------------
    const mtcEstTrigger = await checkUserPermission({
      user: spartaMaintUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportG001,
    });
    assert(
      mtcEstTrigger.authorized === false,
      "I",
      "Sparta Maintenance ESTIMATION_TRIGGER -> DENY (SPARTA Mtc adalah proses/destinasi, bukan pembuat)",
      mtcEstTrigger.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO J: BMS ESTIMATION_TRIGGER -> ALLOW
    // -------------------------------------------------------------------------
    const bmsEstTrigger = await checkUserPermission({
      user: bmsUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportG001,
    });
    assert(
      bmsEstTrigger.authorized === true,
      "J",
      "BMS ESTIMATION_TRIGGER -> ALLOW (Pembuat Estimasi resmi TKP Toko)"
    );

    // -------------------------------------------------------------------------
    // SCENARIO K: BMS ESTIMATION_VIEW -> ALLOW
    // -------------------------------------------------------------------------
    const bmsEstView = await checkUserPermission({
      user: bmsUser,
      permission: "ESTIMATION_VIEW",
      report: reportG001,
    });
    assert(
      bmsEstView.authorized === true,
      "K",
      "BMS ESTIMATION_VIEW -> ALLOW (Melihat status & progres estimasi)"
    );

    // -------------------------------------------------------------------------
    // SCENARIO L: HO Admin ESTIMATION_TRIGGER -> DENY
    // -------------------------------------------------------------------------
    const hoEstTrigger = await checkUserPermission({
      user: hoUser,
      permission: "ESTIMATION_TRIGGER",
      report: reportG001,
    });
    assert(
      hoEstTrigger.authorized === false,
      "L",
      "HO Admin ESTIMATION_TRIGGER -> DENY (Bukan pembuat estimasi cabang)",
      hoEstTrigger.reason
    );

    // -------------------------------------------------------------------------
    // SCENARIO M: Permission Override report existing -> tidak regression
    // -------------------------------------------------------------------------
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const ovrM = await createUserOverride({
      userId: hoUser.id,
      permissionKey: "REPORT_CONFIRM",
      effect: "ALLOW",
      scopeType: "SPECIFIC_BRANCH",
      branchCode: "G001",
      reason: "Penugasan darurat backup verifikasi G001",
      expiresAt: futureDate,
      actor: { id: systemAdminUser.id, name: systemAdminUser.name },
    });

    const hoConfirmG001 = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    const hoConfirmG002 = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG002,
    });
    assert(
      hoConfirmG001.authorized === true && hoConfirmG002.authorized === false,
      "M",
      "Permission Override report existing -> G001 ALLOW, G002 DENY (No regression)"
    );

    // -------------------------------------------------------------------------
    // SCENARIO N: Explicit User DENY tetap mengalahkan Role ALLOW
    // -------------------------------------------------------------------------
    await createUserOverride({
      userId: bmUser1.id,
      permissionKey: "REPORT_CLOSE",
      effect: "DENY",
      scopeType: "OWN_SCOPE",
      reason: "Audit toko sedang berjalan, close dibekukan sementara",
      actor: { id: systemAdminUser.id, name: systemAdminUser.name },
    });

    const bmCloseDeny = await checkUserPermission({
      user: bmUser1,
      permission: "REPORT_CLOSE",
      report: reportG001,
    });
    assert(
      bmCloseDeny.authorized === false,
      "N",
      "Explicit User DENY mengalahkan Role ALLOW -> DENIED"
    );

    // -------------------------------------------------------------------------
    // SCENARIO O: Temporary permission expiry tetap bekerja
    // -------------------------------------------------------------------------
    const pastDate = new Date(Date.now() - 15 * 60 * 1000);
    await pool.query(
      `UPDATE user_permission_overrides SET expires_at = $1 WHERE id = $2`,
      [pastDate, ovrM.id]
    );

    const hoExpiredConfirm = await checkUserPermission({
      user: hoUser,
      permission: "REPORT_CONFIRM",
      report: reportG001,
    });
    assert(
      hoExpiredConfirm.authorized === false,
      "O",
      "Temporary permission expiry -> automatically fails closed (DENIED)"
    );

    console.log("\n==================================================");
    console.log(`TEST SUITE RESULTS: ${passedCount} / ${totalTests} SCENARIOS PASSED`);
    console.log("==================================================");

    if (passedCount !== totalTests) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Test execution failed with error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runTestSuite();
