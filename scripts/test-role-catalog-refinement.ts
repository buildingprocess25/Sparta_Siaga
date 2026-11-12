import { getDbPool } from "../lib/db";
import {
  ROLE_PERMISSION_CATALOG,
  isPermissionInRoleCatalog,
  getRolePermissions,
  updateRolePermissions,
  createUserOverride,
  revokeUserOverride,
  checkUserPermission,
  invalidateRolePermissionsCache,
} from "../lib/permission-service";
import { UserContext } from "../lib/report-permissions";

async function runRoleCatalogTests() {
  console.log("==================================================");
  console.log("SPARTA SIAGA - ROLE PERMISSION CATALOG TESTS (A–J)");
  console.log("==================================================\n");

  const pool = getDbPool();
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, code: string, title: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${code}: ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${code}: ${title} - Detail: ${detail || "Condition not met"}`);
      process.exitCode = 1;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // TEST A: Pilih Branch Manager -> Management Instruction tidak tampil di catalog
    // -------------------------------------------------------------------------
    const bmCatalog = ROLE_PERMISSION_CATALOG["bm"] || [];
    assert(
      !bmCatalog.includes("MANAGEMENT_INSTRUCTION_CREATE"),
      "A",
      "Branch Manager -> Management Instruction tidak termasuk dalam katalog role"
    );

    // -------------------------------------------------------------------------
    // TEST B: Branch Manager -> ESTIMATION_TRIGGER tidak tampil di catalog
    // -------------------------------------------------------------------------
    assert(
      !bmCatalog.includes("ESTIMATION_TRIGGER"),
      "B",
      "Branch Manager -> ESTIMATION_TRIGGER tidak termasuk dalam katalog role"
    );

    // -------------------------------------------------------------------------
    // TEST C: Branch Manager -> ESTIMATION_VIEW tampil (bawaan monitoring)
    // -------------------------------------------------------------------------
    assert(
      bmCatalog.includes("ESTIMATION_VIEW"),
      "C",
      "Branch Manager -> ESTIMATION_VIEW tampil sebagai hak bawaan monitoring cabang"
    );

    // -------------------------------------------------------------------------
    // TEST D: Pilih BMS -> ESTIMATION_TRIGGER tampil di catalog
    // -------------------------------------------------------------------------
    const bmsCatalog = ROLE_PERMISSION_CATALOG["bms"] || [];
    assert(
      bmsCatalog.includes("ESTIMATION_TRIGGER") && bmsCatalog.includes("ESTIMATION_VIEW"),
      "D",
      "BMS -> ESTIMATION_TRIGGER & ESTIMATION_VIEW tampil sebagai hak bawaan pembuat estimasi TKP Toko"
    );

    // -------------------------------------------------------------------------
    // TEST E: Pilih GM HO / SM HO -> Management Instruction tampil di catalog
    // -------------------------------------------------------------------------
    const gmCatalog = ROLE_PERMISSION_CATALOG["gm_ho"] || [];
    const smCatalog = ROLE_PERMISSION_CATALOG["sm_ho"] || [];
    assert(
      gmCatalog.includes("MANAGEMENT_INSTRUCTION_CREATE") &&
        smCatalog.includes("MANAGEMENT_INSTRUCTION_CREATE"),
      "E",
      "GM HO / SM HO -> Management Instruction tampil sebagai hak bawaan role manajemen HO"
    );

    // -------------------------------------------------------------------------
    // TEST F: Permission bawaan diubah OFF -> permission tetap tampil di catalog tetapi status OFF
    // -------------------------------------------------------------------------
    // Toggle BM REPORT_FOLLOW_UP to OFF (DENY)
    await updateRolePermissions("bm", { REPORT_FOLLOW_UP: "DENY" }, {
      id: "admin_test",
      name: "Admin Test",
    });
    invalidateRolePermissionsCache();

    const bmPermsOff = await getRolePermissions("bm");
    assert(
      bmCatalog.includes("REPORT_FOLLOW_UP") && bmPermsOff["REPORT_FOLLOW_UP"] === "DENY",
      "F",
      "Permission bawaan BM (Follow Up) diubah OFF -> tetap ada di catalog role dengan status OFF"
    );

    // Restore to ON (ALLOW)
    await updateRolePermissions("bm", { REPORT_FOLLOW_UP: "ALLOW" }, {
      id: "admin_test",
      name: "Admin Test",
    });
    invalidateRolePermissionsCache();

    // -------------------------------------------------------------------------
    // TEST G: Permission BUKAN bawaan role dicoba diubah melalui API / updateRolePermissions -> DITOLAK
    // -------------------------------------------------------------------------
    let rejectedAsExpected = false;
    let rejectionMessage = "";
    try {
      await updateRolePermissions("bm", { ESTIMATION_TRIGGER: "ALLOW" }, {
        id: "admin_test",
        name: "Admin Test",
      });
    } catch (err: any) {
      rejectedAsExpected = true;
      rejectionMessage = err.message;
    }
    assert(
      rejectedAsExpected && rejectionMessage.includes("bukan merupakan hak bawaan"),
      "G",
      "Permission bukan bawaan role (BM -> ESTIMATION_TRIGGER) dicoba diubah -> DITOLAK oleh backend security"
    );

    // -------------------------------------------------------------------------
    // TEST H: User Override memberikan permission di luar bawaan role -> TETAP DAPAT DILAKUKAN
    // -------------------------------------------------------------------------
    // Find or create a test BM user
    const bmRes = await pool.query(
      `SELECT id, name, system_role, business_role, scope, branch FROM users WHERE business_role = 'bm' LIMIT 1`
    );
    let bmUserRow = bmRes.rows[0];
    if (!bmUserRow) {
      const ins = await pool.query(
        `INSERT INTO users (id, nik, name, email, system_role, business_role, scope, branch, status, created_at, updated_at)
         VALUES ('usr_test_bm_cat', '999911', 'Test BM Cat User', 'bm_cat@example.com', 'USER', 'bm', 'BRANCH', 'G001', 'ACTIVE', NOW(), NOW())
         RETURNING *`
      );
      bmUserRow = ins.rows[0];
    }

    const bmUser: UserContext = {
      id: bmUserRow.id,
      name: bmUserRow.name,
      role: "bm",
      systemRole: "USER",
      scope: "BRANCH",
      branch: bmUserRow.branch || "G001",
    };

    // Give BM user an override for ESTIMATION_TRIGGER (which is NOT in BM catalog)
    const override = await createUserOverride({
      userId: bmUser.id,
      permissionKey: "ESTIMATION_TRIGGER",
      effect: "ALLOW",
      scopeType: "OWN_SCOPE",
      reason: "Penugasan khusus trigger estimasi oleh Branch Manager",
      actor: { id: "admin_test", name: "Admin SPARTA SIAGA" },
    });

    const checkOverrideResult = await checkUserPermission({
      user: bmUser,
      permission: "ESTIMATION_TRIGGER",
      targetBranch: bmUser.branch || "G001",
    });

    assert(
      checkOverrideResult.authorized === true && checkOverrideResult.source === "USER_OVERRIDE_ALLOW",
      "H",
      "User Override memberikan permission di luar bawaan role (BM -> ESTIMATION_TRIGGER) -> BERHASIL (Fleksibilitas Override)"
    );

    // Clean up test override
    await revokeUserOverride(bmUser.id, override.id, { id: "admin_test", name: "Admin Test" });

    // -------------------------------------------------------------------------
    // TEST I: Kategori tanpa permission -> tereliminasi di UI logic (categoryDefs.length === 0)
    // -------------------------------------------------------------------------
    // Check BM categories: LAPORAN (5), NOTIFIKASI (1), MANAGEMENT (0), ESTIMASI (1)
    const bmDefsManagement = ["MANAGEMENT_INSTRUCTION_CREATE"].filter((k) => bmCatalog.includes(k as any));
    const hoDefsConfirm = ["REPORT_CONFIRM", "REPORT_FOLLOW_UP", "REPORT_CLOSE"].filter((k) =>
      (ROLE_PERMISSION_CATALOG["ho_admin"] || []).includes(k as any)
    );
    assert(
      bmDefsManagement.length === 0 && hoDefsConfirm.length === 0,
      "I",
      "Kategori tanpa permission bawaan (BM -> MANAGEMENT; HO Admin -> Konfirmasi/FollowUp/Close) kosong dan dihilangkan"
    );

    // -------------------------------------------------------------------------
    // TEST J: Backend permission regression check
    // -------------------------------------------------------------------------
    // Normal BM on own branch:
    const bmNormal = await checkUserPermission({
      user: bmUser,
      permission: "REPORT_CONFIRM",
      targetBranch: bmUser.branch || "G001",
    });
    assert(
      bmNormal.authorized === true,
      "J",
      "Permission regression check -> BM hak bawaan (Confirm) tetap ALLOWED pada cabang sendiri"
    );

    console.log("\n==================================================");
    console.log(`TEST ROLE CATALOG RESULTS: ${passed} / ${total} TESTS PASSED`);
    console.log("==================================================");
  } finally {
    await pool.end();
  }
}

runRoleCatalogTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
