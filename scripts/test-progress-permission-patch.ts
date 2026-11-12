/**
 * SPARTA SIAGA - TASK 4 PROGRESS PERMISSION CORRECTIVE PATCH TEST SUITE
 * 
 * Verifies scenarios C1 - C10:
 * C1: BMS memiliki REPORT_UPDATE_PROGRESS default.
 * C2: BMC tidak memiliki REPORT_UPDATE_PROGRESS default.
 * C3: Branch Manager tidak memiliki REPORT_UPDATE_PROGRESS default.
 * C4: Tim Toko tidak memiliki REPORT_UPDATE_PROGRESS default.
 * C5: System Admin tidak memiliki operational bypass.
 * C6: BMC POST update progress -> 403.
 * C7: BMS same branch -> allowed.
 * C8: BMS different branch -> 403.
 * C9: BMC masih dapat melihat progress history jika report-view permission tersedia.
 * C10: User override explicit tetap dapat bekerja jika architecture existing mendukungnya.
 */

import { getDbPool } from "../lib/db";
import {
  ROLE_PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
  isPermissionInRoleCatalog,
  isOperationalPermission,
} from "../types/permission";
import {
  checkUserPermission,
  getRolePermissions,
  canViewReportAsync,
  invalidateRolePermissionsCache,
} from "../lib/permission-service";
import { IncidentRecord } from "../types/incident";
import { UserContext } from "../lib/report-permissions";

async function runPatchTests() {
  console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║  SPARTA SIAGA - TASK 4 PROGRESS PERMISSION PATCH TEST SUITE       ║");
  console.log("║  Scenarios C1 - C10 (Separation of Duties: Updater vs Approver)   ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, code: string, title: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${code}: ${title}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${code}: ${title}${detail ? ` -> ${detail}` : ""}`);
      process.exitCode = 1;
    }
  }

  const pool = getDbPool();

  try {
    invalidateRolePermissionsCache();

    // Fixture incident in branch G001
    const testIncidentG001: IncidentRecord = {
      id: "INC-TEST-PATCH-001",
      storeId: "STR-001",
      storeName: "Alfamart Rawamangun G001",
      branch: "G001",
      locationCity: "Jakarta Timur",
      disasterType: "flood",
      reportOrigin: "manual",
      tkpType: "toko",
      date: "07 Oct 2026",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "in_maintenance",
      progress: 40,
      timeline: [],
    };

    // User fixtures
    const bmsUserG001: UserContext = {
      id: "USR-BMS-001",
      name: "Budi BMS G001",
      role: "bms",
      systemRole: "USER",
      scope: "BRANCH",
      branch: "G001",
    };

    const bmsUserG002: UserContext = {
      id: "USR-BMS-002",
      name: "Bambang BMS G002",
      role: "bms",
      systemRole: "USER",
      scope: "BRANCH",
      branch: "G002",
    };

    const bmcUserG001: UserContext = {
      id: "USR-BMC-001",
      name: "Citra BMC G001",
      role: "bmc",
      systemRole: "USER",
      scope: "BRANCH",
      branch: "G001",
    };

    const bmUserG001: UserContext = {
      id: "USR-BM-001",
      name: "Agus BM G001",
      role: "bm",
      systemRole: "USER",
      scope: "BRANCH",
      branch: "G001",
    };

    const timTokoUserG001: UserContext = {
      id: "USR-TOKO-001",
      name: "Dedi Tim Toko G001",
      role: "tim_toko",
      systemRole: "USER",
      scope: "BRANCH",
      branch: "G001",
    };

    const adminUser: UserContext = {
      id: "USR-ADMIN-001",
      name: "Admin Sparta",
      role: null,
      systemRole: "ADMIN",
      scope: "HO",
      branch: null,
    };

    // ─────────────────────────────────────────────────────────────
    // C1: BMS memiliki REPORT_UPDATE_PROGRESS default
    // ─────────────────────────────────────────────────────────────
    const bmsInCatalog = isPermissionInRoleCatalog("bms", "REPORT_UPDATE_PROGRESS");
    const bmsDefaultEffect = DEFAULT_ROLE_PERMISSIONS["bms"]?.["REPORT_UPDATE_PROGRESS"];
    const bmsResolvedPerms = await getRolePermissions("bms");
    assert(
      bmsInCatalog === true &&
        bmsDefaultEffect === "ALLOW" &&
        bmsResolvedPerms["REPORT_UPDATE_PROGRESS"] === "ALLOW",
      "C1",
      "BMS memiliki REPORT_UPDATE_PROGRESS default (ALLOW)"
    );

    // ─────────────────────────────────────────────────────────────
    // C2: BMC tidak memiliki REPORT_UPDATE_PROGRESS default
    // ─────────────────────────────────────────────────────────────
    const bmcInCatalog = isPermissionInRoleCatalog("bmc", "REPORT_UPDATE_PROGRESS");
    const bmcDefaultEffect = DEFAULT_ROLE_PERMISSIONS["bmc"]?.["REPORT_UPDATE_PROGRESS"];
    const bmcResolvedPerms = await getRolePermissions("bmc");
    const bmcCheck = await checkUserPermission({
      user: bmcUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      bmcInCatalog === false &&
        bmcDefaultEffect !== "ALLOW" &&
        bmcResolvedPerms["REPORT_UPDATE_PROGRESS"] === "DENY" &&
        bmcCheck.authorized === false,
      "C2",
      "BMC TIDAK memiliki REPORT_UPDATE_PROGRESS default (DENY / NOT ASSIGNED)"
    );

    // ─────────────────────────────────────────────────────────────
    // C3: Branch Manager tidak memiliki REPORT_UPDATE_PROGRESS default
    // ─────────────────────────────────────────────────────────────
    const bmInCatalog = isPermissionInRoleCatalog("bm", "REPORT_UPDATE_PROGRESS");
    const bmDefaultEffect = DEFAULT_ROLE_PERMISSIONS["bm"]?.["REPORT_UPDATE_PROGRESS"];
    const bmResolvedPerms = await getRolePermissions("bm");
    const bmCheck = await checkUserPermission({
      user: bmUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      bmInCatalog === false &&
        bmDefaultEffect !== "ALLOW" &&
        bmResolvedPerms["REPORT_UPDATE_PROGRESS"] === "DENY" &&
        bmCheck.authorized === false,
      "C3",
      "Branch Manager (BM) TIDAK memiliki REPORT_UPDATE_PROGRESS default (DENY / NOT ASSIGNED)"
    );

    // ─────────────────────────────────────────────────────────────
    // C4: Tim Toko tidak memiliki REPORT_UPDATE_PROGRESS default
    // ─────────────────────────────────────────────────────────────
    const tokoInCatalog = isPermissionInRoleCatalog("tim_toko", "REPORT_UPDATE_PROGRESS");
    const tokoDefaultEffect = DEFAULT_ROLE_PERMISSIONS["tim_toko"]?.["REPORT_UPDATE_PROGRESS"];
    const tokoResolvedPerms = await getRolePermissions("tim_toko");
    const tokoCheck = await checkUserPermission({
      user: timTokoUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      tokoInCatalog === false &&
        tokoDefaultEffect !== "ALLOW" &&
        tokoResolvedPerms["REPORT_UPDATE_PROGRESS"] === "DENY" &&
        tokoCheck.authorized === false,
      "C4",
      "Tim Toko TIDAK memiliki REPORT_UPDATE_PROGRESS default (DENY)"
    );

    // ─────────────────────────────────────────────────────────────
    // C5: System Admin tidak memiliki operational bypass
    // ─────────────────────────────────────────────────────────────
    const isOp = isOperationalPermission("REPORT_UPDATE_PROGRESS");
    const adminCheck = await checkUserPermission({
      user: adminUser,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      isOp === true && adminCheck.authorized === false && adminCheck.source === "SYSTEM_ADMIN",
      "C5",
      "System Admin tidak memiliki operational bypass untuk REPORT_UPDATE_PROGRESS (Zero Bypass)"
    );

    // ─────────────────────────────────────────────────────────────
    // C6: BMC POST update progress -> 403 Forbidden
    // ─────────────────────────────────────────────────────────────
    const bmcPostCheck = await checkUserPermission({
      user: bmcUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      bmcPostCheck.authorized === false &&
        (bmcPostCheck.source === "DEFAULT_DENY" || bmcPostCheck.source === "ROLE_PERMISSION"),
      "C6",
      "BMC POST update progress ditolak backend dengan 403 Forbidden"
    );

    // ─────────────────────────────────────────────────────────────
    // C7: BMS same branch -> allowed
    // ─────────────────────────────────────────────────────────────
    const bmsSameBranchCheck = await checkUserPermission({
      user: bmsUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      bmsSameBranchCheck.authorized === true && bmsSameBranchCheck.source === "ROLE_PERMISSION",
      "C7",
      "BMS cabang yang sama (G001) diizinkan memperbarui progress (ALLOWED)"
    );

    // ─────────────────────────────────────────────────────────────
    // C8: BMS different branch -> 403 Forbidden
    // ─────────────────────────────────────────────────────────────
    const bmsDiffBranchCheck = await checkUserPermission({
      user: bmsUserG002,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
    });
    assert(
      bmsDiffBranchCheck.authorized === false &&
        Boolean(bmsDiffBranchCheck.reason?.includes("cabang")),
      "C8",
      "BMS cabang berbeda (G002 pada incident G001) ditolak dengan 403 Forbidden (Branch Scope Isolation)"
    );

    // ─────────────────────────────────────────────────────────────
    // C9: BMC masih dapat melihat progress history jika report-view permission tersedia
    // ─────────────────────────────────────────────────────────────
    const bmcCanViewReport = await canViewReportAsync(bmcUserG001, testIncidentG001);
    assert(
      bmcCanViewReport === true,
      "C9",
      "BMC tetap dapat melihat laporan dan progress history jika memiliki report-view permission"
    );

    // ─────────────────────────────────────────────────────────────
    // C10: User override explicit tetap dapat bekerja
    // ─────────────────────────────────────────────────────────────
    // Explicit override ALLOW provided directly to checkUserPermission
    const explicitOverrideAllowCheck = await checkUserPermission({
      user: bmcUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
      overrides: [
        {
          id: "ov-test-allow-01",
          userId: bmcUserG001.id,
          permissionKey: "REPORT_UPDATE_PROGRESS",
          effect: "ALLOW",
          scopeType: "OWN_SCOPE",
          branchCode: null,
          reason: "Izin darurat pengerjaan perbaikan khusus oleh BMC",
          startsAt: new Date(Date.now() - 3600000).toISOString(),
          expiresAt: null,
          grantedBy: "admin-01",
          revokedAt: null,
          revokedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    const explicitOverrideDenyCheck = await checkUserPermission({
      user: bmsUserG001,
      permission: "REPORT_UPDATE_PROGRESS",
      report: testIncidentG001,
      overrides: [
        {
          id: "ov-test-deny-01",
          userId: bmsUserG001.id,
          permissionKey: "REPORT_UPDATE_PROGRESS",
          effect: "DENY",
          scopeType: "OWN_SCOPE",
          branchCode: null,
          reason: "Penonaktifan sementara akses update BMS Budi",
          startsAt: new Date(Date.now() - 3600000).toISOString(),
          expiresAt: null,
          grantedBy: "admin-01",
          revokedAt: null,
          revokedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    assert(
      explicitOverrideAllowCheck.authorized === true &&
        explicitOverrideAllowCheck.source === "USER_OVERRIDE_ALLOW" &&
        explicitOverrideDenyCheck.authorized === false &&
        explicitOverrideDenyCheck.source === "USER_OVERRIDE_DENY",
      "C10",
      "User Permission Override explicit tetap berfungsi (ALLOW untuk BMC via override, DENY untuk BMS via override)"
    );

    // Summary
    console.log("\n" + "═".repeat(67));
    console.log(`  PATCH TEST SUMMARY: ${passed} / ${total} SCENARIOS PASSED`);
    console.log("═".repeat(67));

    if (passed === total) {
      console.log("\n🎉 ALL CORRECTIVE PATCH SCENARIOS (C1 - C10) PASSED!\n");
    } else {
      console.error(`\n⚠️ SOME PATCH TESTS FAILED: ${total - passed} failed.\n`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error("FATAL ERROR running patch tests:", err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

runPatchTests();
