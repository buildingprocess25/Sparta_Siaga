/**
 * TASK 3 INTEGRATION TEST SUITE: SPARTA SIAGA SSO Frontend & Backend Integration
 * 
 * Verifies:
 * 1. Zero runtime DDL: Session creation, rotation, revocation, and identity resolution execute 0 DDL statements.
 * 2. SSO Frontend Login: SPARTA SSO portal button, error mappings, and internal credential divider.
 * 3. Identity & Position: Head Office 'admin' resolves to 'Staff Head Office', System Admin resolves cleanly, Branch roles resolve to 'Staff Cabang'.
 * 4. Active Role UI Enforcement: Exactly 9 canonical SIAGA roles; legacy HO roles (ho_admin, gm_ho, sm_ho) are non-selectable and omitted from active filter dropdowns.
 * 5. Display Maps: incident-app-shell displays 'admin' and 'bbs' correctly.
 * 6. Migration Decoupling: Session schema migration executes safely in isolated environment and is decoupled from runtime auth.
 */

import fs from "fs";
import path from "path";
import { getDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { 
  createDeviceSession, 
  rotateDeviceSession, 
  revokeSessionByRefreshToken, 
  revokeAllUserSessions,
  getUserActiveSessions
} from "../lib/session-service";
import {
  CANONICAL_HUMAN_ROLES,
  HUMAN_SELECTABLE_HO_ROLES,
  HUMAN_SELECTABLE_BRANCH_ROLES,
  getBusinessRoleDefinition,
  getRoleDisplayLabel,
  isValidHumanBusinessRole
} from "../lib/role-catalog";
import { resolveUserIdentityFromSession } from "../lib/identity";
import { dbUpsertUser, dbGetUserById, UserModel } from "../lib/user-db";
import { runSessionSchemaMigration } from "./migrate-session-schema";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failedCount++;
    console.error(`  [FAIL] ${testName}${detail ? ` — ${detail}` : ""}`);
  }
}

async function runTask3Tests() {
  console.log("==================================================================");
  console.log("SPARTA SIAGA — TASK 3 SSO Frontend & Backend Integration Tests");
  console.log("==================================================================\n");

  const pool = getDbPool();
  await assertIsolatedDatabase(pool);

  // Setup test user in isolated test database
  const testUserId = "usr_task3_test_admin";
  const testUserData: UserModel = {
    id: testUserId,
    name: "Task 3 HO Admin Tester",
    nik: "HO-TK3-001",
    email: "task3.admin@sparta-test.com",
    systemRole: "USER",
    businessRole: "admin",
    scope: "HO",
    branch: null,
    status: "ACTIVE",
    source: "LOCAL",
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await dbUpsertUser(testUserData);

  // -------------------------------------------------------------
  // TEST SUITE 1: ZERO RUNTIME DDL DURING AUTHENTICATION & SESSIONS
  // -------------------------------------------------------------
  console.log("[SUITE 1] Zero Runtime DDL Verification");
  {
    const ddlRegex = /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX)\b/i;
    const executedQueries: string[] = [];

    // Intercept pool.query to spy on all SQL statements
    const originalQuery = pool.query.bind(pool);
    pool.query = function (...args: any[]) {
      const sql = typeof args[0] === "string" ? args[0] : (args[0]?.text || "");
      executedQueries.push(sql);
      return (originalQuery as any).apply(pool, args);
    } as any;

    try {
      // 1.1 Create Session
      const sessionResult = await createDeviceSession({
        userId: testUserId,
        userAgent: "Task3TestBrowser/1.0",
        ipAddress: "127.0.0.1"
      });
      assert(Boolean(sessionResult && sessionResult.accessToken && sessionResult.refreshToken), "1.1 createDeviceSession produces valid tokens");

      // 1.2 Rotate Session (RTR)
      let refreshedResult = null;
      if (sessionResult) {
        refreshedResult = await rotateDeviceSession(sessionResult.refreshToken, {
          userAgent: "Task3TestBrowser/1.0",
          ipAddress: "127.0.0.1",
          allowGracePeriod: true
        });
      }
      assert(Boolean(refreshedResult && refreshedResult.accessToken), "1.2 rotateDeviceSession successfully rotates tokens");

      // 1.3 Active Sessions Listing
      const activeSessions = await getUserActiveSessions(testUserId);
      assert(activeSessions.length > 0, "1.3 getUserActiveSessions returns active sessions");

      // 1.4 Revoke Single Session
      if (refreshedResult) {
        const revoked = await revokeSessionByRefreshToken(refreshedResult.refreshToken);
        assert(revoked, "1.4 revokeSessionByRefreshToken revokes active token");
      }

      // 1.5 Revoke All User Sessions
      const bumpedVersion = await revokeAllUserSessions(testUserId);
      assert(bumpedVersion >= 2, "1.5 revokeAllUserSessions bumps token_version");

      // Check all queries executed during runtime session operations
      const ddlStatements = executedQueries.filter(q => ddlRegex.test(q));
      assert(
        ddlStatements.length === 0, 
        "1.6 Zero runtime DDL statements executed during all session lifecycle operations",
        ddlStatements.length > 0 ? `Found DDL: ${ddlStatements.join(" | ")}` : undefined
      );
    } finally {
      // Restore original pool.query
      pool.query = originalQuery;
    }
  }

  // -------------------------------------------------------------
  // TEST SUITE 2: SSO FRONTEND LOGIN PAGE INTEGRATION
  // -------------------------------------------------------------
  console.log("\n[SUITE 2] SSO Frontend Login Page Verification");
  {
    const loginPagePath = path.join(process.cwd(), "app", "login", "page.tsx");
    const loginPageSource = fs.readFileSync(loginPagePath, "utf8");

    // 2.1 SPARTA SSO Portal Login Button
    assert(
      loginPageSource.includes("sso-portal-login-button") &&
      loginPageSource.includes("Masuk via Portal SPARTA (SSO)"),
      "2.1 Login page contains prominent 'Masuk via Portal SPARTA (SSO)' button"
    );

    // 2.2 SPARTA Portal URL Configuration
    assert(
      loginPageSource.includes("spartaLoginUrl") &&
      loginPageSource.includes("NEXT_PUBLIC_SPARTA_LOGIN_URL"),
      "2.2 Login page uses configurable SPARTA login portal URL via NEXT_PUBLIC_SPARTA_LOGIN_URL"
    );

    // 2.3 Divider for Internal Credentials
    assert(
      loginPageSource.includes("Atau Kredensial Khusus"),
      "2.3 Login page provides clear visual divider for internal credentials fallback"
    );

    // 2.4 Complete SSO Error Mappings
    const requiredErrorKeys = [
      "MissingToken",
      "InvalidToken",
      "TokenExpired",
      "TokenConsumed",
      "ModuleMismatch",
      "UnauthorizedModule",
      "InvalidPayload",
      "UserNotFound",
      "InactiveAccount",
      "AmbiguousIdentity",
      "DeactivatedRole",
      "SessionCreationFailed",
      "SsoServiceUnavailable",
      "ServerError"
    ];
    const missingKeys = requiredErrorKeys.filter(k => !loginPageSource.includes(`${k}:`));
    assert(
      missingKeys.length === 0,
      `2.4 Login page implements all 14 standard SPARTA SSO error mappings`,
      missingKeys.length > 0 ? `Missing: ${missingKeys.join(", ")}` : undefined
    );
  }

  // -------------------------------------------------------------
  // TEST SUITE 3: IDENTITY & POSITION RESOLUTION
  // -------------------------------------------------------------
  console.log("\n[SUITE 3] Identity & Position Resolution Verification");
  {
    // 3.1 System Administrator Identity
    const sysAdminIdentity = await resolveUserIdentityFromSession({
      id: "usr_sysadmin",
      name: "Root Administrator",
      systemRole: "ADMIN",
      role: null,
      scope: null,
      branch: null,
      nik: "00000000"
    });
    assert(
      Boolean(
        sysAdminIdentity && 
        sysAdminIdentity.position === "System Administrator" && 
        sysAdminIdentity.systemRole === "ADMIN" &&
        sysAdminIdentity.businessRole === null
      ),
      "3.1 System Administrator resolves position 'System Administrator' with null business role"
    );

    // 3.2 Head Office Admin ('admin')
    const hoAdminIdentity = await resolveUserIdentityFromSession({
      id: "usr_ho_admin",
      name: "HO Admin User",
      systemRole: "USER",
      role: "admin",
      scope: "HO",
      branch: null,
      nik: "12345678"
    });
    assert(
      Boolean(
        hoAdminIdentity && 
        hoAdminIdentity.position === "Staff Head Office" && 
        hoAdminIdentity.businessRole === "admin" &&
        hoAdminIdentity.scope === "HO"
      ),
      "3.2 Head Office 'admin' resolves position 'Staff Head Office' and scope 'HO'"
    );

    // 3.3 Legacy HO role backward compatibility ('ho_admin')
    const legacyHoIdentity = await resolveUserIdentityFromSession({
      id: "usr_legacy_ho",
      name: "Legacy HO User",
      systemRole: "USER",
      role: "ho_admin",
      scope: "HO",
      branch: null,
      nik: "87654321"
    });
    assert(
      Boolean(legacyHoIdentity && legacyHoIdentity.position === "Staff Head Office"),
      "3.3 Legacy HO role 'ho_admin' resolves position 'Staff Head Office'"
    );

    // 3.4 Branch Role ('bm')
    const bmIdentity = await resolveUserIdentityFromSession({
      id: "usr_bm",
      name: "Branch Manager User",
      systemRole: "USER",
      role: "bm",
      scope: "BRANCH",
      branch: "G001",
      nik: "11223344"
    });
    assert(
      Boolean(
        bmIdentity && 
        bmIdentity.position === "Staff Cabang" && 
        bmIdentity.businessRole === "bm" &&
        bmIdentity.scope === "BRANCH" &&
        bmIdentity.branch === "G001"
      ),
      "3.4 Branch Manager 'bm' resolves position 'Staff Cabang' and branch 'G001'"
    );

    // 3.5 Branch Specialist ('bbs')
    const bbsIdentity = await resolveUserIdentityFromSession({
      id: "usr_bbs",
      name: "BBS User",
      systemRole: "USER",
      role: "bbs",
      scope: "BRANCH",
      branch: "G001",
      nik: "55667788"
    });
    assert(
      Boolean(bbsIdentity && bbsIdentity.position === "Staff Cabang" && bbsIdentity.businessRole === "bbs"),
      "3.5 Branch Building Support 'bbs' resolves position 'Staff Cabang' and role 'bbs'"
    );
  }

  // -------------------------------------------------------------
  // TEST SUITE 4: ACTIVE ROLE UI & FILTER DROPDOWN ENFORCEMENT
  // -------------------------------------------------------------
  console.log("\n[SUITE 4] Active Role UI & Canonical 9 Roles Enforcement");
  {
    // 4.1 Selectable HO Roles (Consolidated to Admin only)
    assert(
      HUMAN_SELECTABLE_HO_ROLES.length === 1 && HUMAN_SELECTABLE_HO_ROLES[0].key === "admin",
      "4.1 HUMAN_SELECTABLE_HO_ROLES contains ONLY consolidated 'admin'",
      `Actual HO roles: ${HUMAN_SELECTABLE_HO_ROLES.map(r => r.key).join(", ")}`
    );

    // 4.2 Legacy HO roles non-selectable
    const legacyKeys = ["ho_admin", "gm_ho", "sm_ho"];
    const allLegacyNonSelectable = legacyKeys.every(k => {
      const def = getBusinessRoleDefinition(k);
      return def && def.selectable === false && def.category === "LEGACY";
    });
    assert(
      allLegacyNonSelectable,
      "4.2 Legacy HO roles (ho_admin, gm_ho, sm_ho) are category 'LEGACY' and selectable: false"
    );

    // 4.3 Selectable Branch Roles
    const expectedBranchKeys = ["bm", "bms", "bmc", "bes", "bec", "bbs", "bbc"];
    const actualBranchKeys = HUMAN_SELECTABLE_BRANCH_ROLES.map(r => r.key);
    const branchKeysMatch = 
      expectedBranchKeys.length === actualBranchKeys.length &&
      expectedBranchKeys.every(k => actualBranchKeys.includes(k));
    assert(
      branchKeysMatch,
      `4.3 HUMAN_SELECTABLE_BRANCH_ROLES matches exactly the 7 branch operational roles (${expectedBranchKeys.join(", ")})`,
      `Actual: ${actualBranchKeys.join(", ")}`
    );

    // 4.4 Exactly 8 Human Business Roles Selectable (+ 1 System Administrator = 9 finalized roles)
    const allSelectable = CANONICAL_HUMAN_ROLES.filter(r => r.selectable);
    assert(
      allSelectable.length === 8,
      `4.4 Exactly 8 selectable human business roles (${allSelectable.map(r => r.key).join(", ")})`
    );

    // 4.5 Role Display Labels
    assert(getRoleDisplayLabel("admin") === "Admin", "4.5.1 Role display label for 'admin' is 'Admin'");
    assert(getRoleDisplayLabel("bm") === "BnM Manajer", "4.5.2 Role display label for 'bm' is 'BnM Manajer'");
    assert(getRoleDisplayLabel("bbs") === "BBS", "4.5.3 Role display label for 'bbs' is 'BBS'");
    assert(getRoleDisplayLabel("sys_admin") === "Admin SPARTA SIAGA", "4.5.4 Role display label for sys_admin is 'Admin SPARTA SIAGA'");

    // 4.6 incident-app-shell display map includes admin and bbs
    const appShellPath = path.join(process.cwd(), "components", "layout", "incident-app-shell.tsx");
    const appShellSource = fs.readFileSync(appShellPath, "utf8");
    assert(
      appShellSource.includes('admin: "Admin"') && appShellSource.includes('bbs: "BBS"'),
      "4.6 incident-app-shell businessRoleDisplayMap includes 'admin' and 'bbs'"
    );

    // 4.7 User Management Filter dropdown excludes legacy HO roles and store_crew
    const usersPagePath = path.join(process.cwd(), "app", "(siaga)", "admin", "users", "page.tsx");
    const usersPageSource = fs.readFileSync(usersPagePath, "utf8");
    const containsLegacyHoInFilter = 
      usersPageSource.includes('<option value="gm_ho">') ||
      usersPageSource.includes('<option value="sm_ho">') ||
      usersPageSource.includes('<option value="ho_admin">');
    const containsStoreCrewInFilter = usersPageSource.includes('<option value="store_crew">');
    assert(
      !containsLegacyHoInFilter && !containsStoreCrewInFilter,
      "4.7 User Management active role filter dropdown excludes legacy HO roles and store_crew"
    );
  }

  // -------------------------------------------------------------
  // TEST SUITE 5: STAGING SESSION SCHEMA MIGRATION DECOUPLING
  // -------------------------------------------------------------
  console.log("\n[SUITE 5] Staging Session Schema Migration Decoupling");
  {
    // 5.1 Standalone Migration Script Exists and Runs Safely
    let migrationRanWithoutError = false;
    try {
      await runSessionSchemaMigration();
      migrationRanWithoutError = true;
    } catch (err) {
      console.error("Migration error:", err);
    }
    assert(migrationRanWithoutError, "5.1 runSessionSchemaMigration executes safely and idempotently on isolated DB");

    // 5.2 Verification of user_sessions table in isolated DB
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'user_sessions'
    `);
    assert(tableCheck.rowCount === 1, "5.2 user_sessions table exists in isolated test DB");
  }

  // -------------------------------------------------------------
  // CLEANUP & SUMMARY
  // -------------------------------------------------------------
  // Clean up test user
  await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [testUserId]);
  await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);

  console.log("\n==================================================================");
  console.log(`TASK 3 INTEGRATION TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("==================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTask3Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Unexpected test failure:", err);
    process.exit(1);
  });
