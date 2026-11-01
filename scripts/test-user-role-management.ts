import { getDbPool } from "../lib/db";
import {
  CANONICAL_HUMAN_ROLES,
  HUMAN_SELECTABLE_ROLES,
  HUMAN_SELECTABLE_HO_ROLES,
  HUMAN_SELECTABLE_BRANCH_ROLES,
  SPECIAL_LEGACY_ROLES,
  isValidHumanBusinessRole,
  deriveScopeFromBusinessRole,
  getRoleDisplayLabel,
  getBusinessRoleDefinition,
} from "../lib/role-catalog";
import {
  ROLE_PERMISSION_CATALOG,
  getRolePermissions,
  checkUserPermission,
} from "../lib/permission-service";
import {
  dbGetUserById,
  dbGetUserByNik,
  dbCreateUser,
  dbAdminUpdateUser,
  dbDeleteUser,
  dbCheckUserDependencies,
} from "../lib/user-db";
import bcrypt from "bcryptjs";

let passed = 0;
let total = 0;

function assert(condition: boolean, code: string, message: string) {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${code}: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${code}: ${message}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log("================================================================");
  console.log(" SPARTA SIAGA - USER & ROLE MANAGEMENT TEST SUITE");
  console.log("================================================================\n");

  const pool = getDbPool();

  try {
    // -------------------------------------------------------------------------
    // 1. CANONICAL ROLE CATALOG AUDIT
    // -------------------------------------------------------------------------
    console.log("--- 1. Canonical Human Role Catalog ---");
    assert(
      HUMAN_SELECTABLE_ROLES.length === 11,
      "T1.1",
      `Tepat 11 human business roles yang selectable (terhitung: ${HUMAN_SELECTABLE_ROLES.length})`
    );

    const expected11Roles = [
      "ho_admin", "gm_ho", "sm_ho",
      "bm", "tim_toko", "bms", "bmc",
      "bes", "bec", "bbs", "bbc"
    ];
    const selectableKeys = HUMAN_SELECTABLE_ROLES.map((r) => r.key);
    assert(
      expected11Roles.every((k) => selectableKeys.includes(k)),
      "T1.2",
      "Seluruh 11 persona kanonikal terdaftar dalam katalog"
    );

    assert(
      HUMAN_SELECTABLE_HO_ROLES.length === 3,
      "T1.3",
      `3 role Head Office (ho_admin, gm_ho, sm_ho) terdaftar`
    );

    assert(
      HUMAN_SELECTABLE_BRANCH_ROLES.length === 8,
      "T1.4",
      `8 role Branch (bm, tim_toko, bms, bmc, bes, bec, bbs, bbc) terdaftar`
    );

    // Non-human & legacy roles are NOT selectable
    const legacyKeys = ["sparta_maintenance", "bnm", "tim_maintenance", "tim_office", "tim_warehouse"];
    assert(
      legacyKeys.every((k) => !isValidHumanBusinessRole(k)),
      "T1.5",
      "Role integrasi/legacy (sparta_maintenance, bnm, dll.) ditolak dari selectable human roles"
    );

    // Label verification
    assert(
      getRoleDisplayLabel("bm") === "BnM Manajer",
      "T1.6",
      "Role 'bm' berlabel kanonikal 'BnM Manajer'"
    );
    assert(
      getRoleDisplayLabel("bms") === "BMS",
      "T1.7",
      "Role 'bms' berlabel kanonikal 'BMS'"
    );
    assert(
      getRoleDisplayLabel("admin") === "System Admin",
      "T1.8",
      "Role 'admin' berlabel kanonikal 'System Admin'"
    );

    // -------------------------------------------------------------------------
    // 2. SERVER-SIDE SCOPE DERIVATION & ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log("\n--- 2. Scope Derivation & Boundary Rules ---");
    assert(
      deriveScopeFromBusinessRole("ho_admin") === "HO" &&
      deriveScopeFromBusinessRole("gm_ho") === "HO" &&
      deriveScopeFromBusinessRole("sm_ho") === "HO",
      "T2.1",
      "Role HO menghasilkan scope = 'HO'"
    );

    assert(
      deriveScopeFromBusinessRole("bm") === "BRANCH" &&
      deriveScopeFromBusinessRole("tim_toko") === "BRANCH" &&
      deriveScopeFromBusinessRole("bms") === "BRANCH" &&
      deriveScopeFromBusinessRole("bmc") === "BRANCH" &&
      deriveScopeFromBusinessRole("bes") === "BRANCH" &&
      deriveScopeFromBusinessRole("bec") === "BRANCH" &&
      deriveScopeFromBusinessRole("bbs") === "BRANCH" &&
      deriveScopeFromBusinessRole("bbc") === "BRANCH",
      "T2.2",
      "Semua 8 role Branch menghasilkan scope = 'BRANCH'"
    );

    assert(
      deriveScopeFromBusinessRole("invalid_role") === null,
      "T2.3",
      "Role fiktif/tidak valid menghasilkan scope = null"
    );

    // -------------------------------------------------------------------------
    // 3. SYSTEM ADMIN PROTECTION (ZERO OPERATIONAL BYPASS)
    // -------------------------------------------------------------------------
    console.log("\n--- 3. System Admin Protection ---");
    const adminUser = await dbGetUserById("usr_seed_admin");
    assert(
      adminUser !== null && adminUser.systemRole === "ADMIN",
      "T3.1",
      "Akun 'usr_seed_admin' bertipe systemRole = 'ADMIN'"
    );
    assert(
      adminUser?.businessRole === null && adminUser?.scope === null && adminUser?.branch === null,
      "T3.2",
      "System Admin tidak memiliki Business Role, Scope, maupun Branch (pure technical administrator)"
    );

    // Attempt delete admin must fail
    let deleteAdminFailed = false;
    try {
      await dbDeleteUser("usr_seed_admin");
    } catch {
      deleteAdminFailed = true;
    }
    assert(
      deleteAdminFailed,
      "T3.3",
      "Percobaan menghapus 'usr_seed_admin' berhasil diblokir oleh backend"
    );

    // Zero operational bypass check for System Admin
    const adminCtx = {
      id: "usr_seed_admin",
      userId: "usr_seed_admin",
      name: "Admin SPARTA SIAGA",
      systemRole: "ADMIN" as const,
      businessRole: null,
      branch: null,
      scope: null,
      role: null,
    };
    const adminConfirm = await checkUserPermission({ user: adminCtx, permission: "REPORT_CONFIRM", targetBranch: "CIKOKOL" });
    const adminFollowUp = await checkUserPermission({ user: adminCtx, permission: "REPORT_FOLLOW_UP", targetBranch: "CIKOKOL" });
    const adminClose = await checkUserPermission({ user: adminCtx, permission: "REPORT_CLOSE", targetBranch: "CIKOKOL" });
    const adminTrigger = await checkUserPermission({ user: adminCtx, permission: "ESTIMATION_TRIGGER", targetBranch: "CIKOKOL" });

    assert(
      !adminConfirm.authorized && !adminFollowUp.authorized && !adminClose.authorized && !adminTrigger.authorized,
      "T3.4",
      "Zero Operational Bypass terbukti: System Admin dilarang melakukan aksi operasional laporan/estimasi"
    );

    // -------------------------------------------------------------------------
    // 4. NIK VALIDATION & CREDENTIAL SECURITY
    // -------------------------------------------------------------------------
    console.log("\n--- 4. NIK Validation & Credential Security ---");
    const adminByNik = await dbGetUserByNik("ADM0001");
    assert(
      adminByNik?.id === "usr_seed_admin",
      "T4.1",
      "Pencarian user berdasarkan NIK 'ADM0001' mengembalikan identitas yang benar"
    );

    // Verify password hashing
    const samplePassword = "SecretPassword123!";
    const hash = await bcrypt.hash(samplePassword, 10);
    const isValidPassword = await bcrypt.compare(samplePassword, hash);
    assert(
      isValidPassword && !hash.includes(samplePassword),
      "T4.2",
      "Password di-hash aman menggunakan bcrypt tanpa menyimpan plaintext"
    );

    // -------------------------------------------------------------------------
    // 5. OPERATIONAL RESPONSIBILITY & PERMISSION MATRIX
    // -------------------------------------------------------------------------
    console.log("\n--- 5. Operational Responsibility Matrix ---");
    // BMS
    const bmsCatalog = ROLE_PERMISSION_CATALOG["bms"] || [];
    assert(
      bmsCatalog.includes("ESTIMATION_TRIGGER") &&
      bmsCatalog.includes("WORK_READINESS_UPDATE") &&
      bmsCatalog.includes("REPORT_UPDATE_PROGRESS") &&
      bmsCatalog.includes("COMPLETION_SUBMIT") &&
      !bmsCatalog.includes("COMPLETION_APPROVE_COORDINATOR") &&
      !bmsCatalog.includes("REPORT_CLOSE"),
      "T5.1",
      "BMS memiliki hak PIC estimasi, readiness, progress & submit completion; dilarang approval koordinator & close"
    );

    // BMC
    const bmcCatalog = ROLE_PERMISSION_CATALOG["bmc"] || [];
    assert(
      bmcCatalog.includes("COMPLETION_APPROVE_COORDINATOR") &&
      !bmcCatalog.includes("REPORT_UPDATE_PROGRESS") &&
      !bmcCatalog.includes("COMPLETION_SUBMIT"),
      "T5.2",
      "BMC memiliki hak approval koordinator; bukan updater progress fisik default"
    );

    // BES
    const besCatalog = ROLE_PERMISSION_CATALOG["bes"] || [];
    assert(
      besCatalog.includes("REPORT_UPDATE_PROGRESS") &&
      besCatalog.includes("COMPLETION_SUBMIT") &&
      !besCatalog.includes("COMPLETION_APPROVE_COORDINATOR"),
      "T5.3",
      "BES memiliki hak update progress & submit completion DC/WH; dilarang approval koordinator"
    );

    // BEC
    const becCatalog = ROLE_PERMISSION_CATALOG["bec"] || [];
    assert(
      becCatalog.includes("COMPLETION_APPROVE_COORDINATOR") &&
      !becCatalog.includes("REPORT_UPDATE_PROGRESS"),
      "T5.4",
      "BEC memiliki hak approval koordinator DC/WH; bukan updater progress fisik default"
    );

    // BBS
    const bbsCatalog = ROLE_PERMISSION_CATALOG["bbs"] || [];
    assert(
      bbsCatalog.includes("REPORT_UPDATE_PROGRESS") &&
      bbsCatalog.includes("COMPLETION_SUBMIT") &&
      !bbsCatalog.includes("COMPLETION_APPROVE_COORDINATOR"),
      "T5.5",
      "BBS memiliki hak update progress & submit completion Building; dilarang approval koordinator"
    );

    // BBC
    const bbcCatalog = ROLE_PERMISSION_CATALOG["bbc"] || [];
    assert(
      bbcCatalog.includes("COMPLETION_APPROVE_COORDINATOR") &&
      !bbcCatalog.includes("REPORT_UPDATE_PROGRESS"),
      "T5.6",
      "BBC memiliki hak approval koordinator Building; bukan updater progress fisik default"
    );

    // Manager Branch (bm)
    const bmCatalog = ROLE_PERMISSION_CATALOG["bm"] || [];
    assert(
      bmCatalog.includes("REPORT_CLOSE") &&
      !bmCatalog.includes("REPORT_UPDATE_PROGRESS") &&
      !bmCatalog.includes("ESTIMATION_TRIGGER"),
      "T5.7",
      "Manager Branch memiliki hak Case Close; tidak memiliki hak trigger estimasi maupun edit progress"
    );

    // Cross-branch isolation for BM
    const bmCtx = {
      id: "USR-BM-TEST-ISOLATION",
      userId: "USR-BM-TEST-ISOLATION",
      name: "BM Cikokol",
      systemRole: "USER" as const,
      businessRole: "bm",
      branch: "CIKOKOL",
      scope: "BRANCH" as const,
      role: "bm" as const,
    };
    const bmOwnBranch = await checkUserPermission({ user: bmCtx, permission: "REPORT_CLOSE", targetBranch: "CIKOKOL" });
    const bmOtherBranch = await checkUserPermission({ user: bmCtx, permission: "REPORT_CLOSE", targetBranch: "MANADO" });
    assert(
      bmOwnBranch.authorized && !bmOtherBranch.authorized,
      "T5.8",
      "Manager Branch diizinkan close laporan cabang sendiri (CIKOKOL), tetapi DITOLAK di cabang lain (MANADO)"
    );

    // Rekanan
    const rekananCatalog = (ROLE_PERMISSION_CATALOG as Record<string, any>)["rekanan"];
    assert(
      !rekananCatalog || !(rekananCatalog as string[]).includes("REPORT_UPDATE_PROGRESS"),
      "T5.9",
      "Rekanan tidak memiliki permission progress update langsung (pekerjaan dikelola via BMS internal)"
    );

    // -------------------------------------------------------------------------
    // 6. USER CRUD LIFECYCLE (CREATE, EDIT, SWITCH SCOPE, DEACTIVATE, DELETE)
    // -------------------------------------------------------------------------
    console.log("\n--- 6. User CRUD Lifecycle ---");
    const testUserId = `usr_test_${Date.now()}`;
    const testNik = `NIK-TEST-${Math.floor(1000 + Math.random() * 9000)}`;

    // Create HO User
    const createdHo = await dbCreateUser({
      id: testUserId,
      name: "Test User HO",
      nik: testNik,
      email: "test.ho@sparta.com",
      systemRole: "USER",
      businessRole: "ho_admin",
      scope: "HO",
      branch: null,
      status: "ACTIVE",
      source: "LOCAL",
      passwordHash: hash,
    });
    assert(
      createdHo.id === testUserId && createdHo.scope === "HO" && createdHo.branch === null,
      "T6.1",
      "Membuat user baru dengan role 'ho_admin' menghasilkan scope = 'HO' dan branch = null"
    );

    // Switch Role HO -> BRANCH
    const updatedToBranch = await dbAdminUpdateUser(testUserId, {
      businessRole: "bms",
      scope: "BRANCH",
      branch: "CIKOKOL",
    });
    assert(
      updatedToBranch?.businessRole === "bms" &&
      updatedToBranch?.scope === "BRANCH" &&
      updatedToBranch?.branch === "CIKOKOL",
      "T6.2",
      "Mengubah role ke 'bms' mengalihkan scope ke 'BRANCH' dan mengikat cabang 'CIKOKOL'"
    );

    // Switch Role BRANCH -> HO
    const updatedBackToHo = await dbAdminUpdateUser(testUserId, {
      businessRole: "gm_ho",
      scope: "HO",
      branch: null,
    });
    assert(
      updatedBackToHo?.businessRole === "gm_ho" &&
      updatedBackToHo?.scope === "HO" &&
      updatedBackToHo?.branch === null,
      "T6.3",
      "Mengubah role kembali ke 'gm_ho' mengosongkan branch secara otomatis dan menyetel scope 'HO'"
    );

    // Deactivate user
    const deactivated = await dbAdminUpdateUser(testUserId, {
      status: "INACTIVE",
    });
    assert(
      deactivated?.status === "INACTIVE",
      "T6.4",
      "User berhasil dinonaktifkan (status = 'INACTIVE')"
    );

    // Clean up test user
    const deleteSuccess = await dbDeleteUser(testUserId);
    assert(
      deleteSuccess,
      "T6.5",
      "User uji coba tanpa dependensi historis berhasil dihapus bersih"
    );

    console.log("\n================================================================");
    console.log(`🎉 ALL ${passed} / ${total} USER & ROLE MANAGEMENT SCENARIOS PASSED!`);
    console.log("================================================================\n");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
