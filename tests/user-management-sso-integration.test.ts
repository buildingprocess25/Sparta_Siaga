import assert from "node:assert/strict";
import test from "node:test";
import { getDbPool, closeDbPool } from "../lib/db";
import { GET as getUsersGet } from "../app/api/admin/users/route";
import { PATCH as userPatch, DELETE as userDelete } from "../app/api/admin/users/[id]/route";
import { POST as userSyncPost } from "../app/api/admin/users/sync/route";
import { signSession } from "../lib/jwt";
import { checkUserPermission } from "../lib/permission-service";
import { UserContext } from "../lib/report-permissions";
import {
  querySpartaBatchModuleGrants,
  querySpartaUserModuleGrant,
  clearGrantCache,
} from "../lib/sso-service";

test("User Management & SSO Integration Verification Suite", async (t) => {
  const pool = getDbPool();

  async function createAuthHeaders(userId: string) {
    const token = await signSession({ id: userId });
    return {
      cookie: `siaga_session=${token}`,
      "Content-Type": "application/json",
    };
  }

  await t.test("1. System Administrator can access /api/admin/users", async () => {
    const headers = await createAuthHeaders("usr_sysadmin_01");
    const req = new Request("http://localhost/api/admin/users", { headers });

    const response = await getUsersGet(req);
    assert.equal(response.status, 200);

    const json = await response.json();
    assert.ok(Array.isArray(json.data), "Expected data to be an array of users");
    assert.ok(json.data.length > 0, "Expected users to be returned");

    // Verify passwordHash is never exposed and enriched fields exist
    for (const u of json.data) {
      assert.equal(u.passwordHash, undefined, "passwordHash must never be exposed in API");
      assert.ok(u.classification, "Classification must be computed for each user");
      assert.ok(u.ssoGrantStatus, "SSO grant status must be computed for each user");
    }

    // Verify System Administrator recognition
    const sysAdmin = json.data.find((u: any) => u.id === "usr_sysadmin_01");
    assert.ok(sysAdmin, "usr_sysadmin_01 must be in users list");
    assert.equal(sysAdmin.systemRole, "ADMIN");
    assert.equal(sysAdmin.classification, "SYSTEM_ADMIN");
    assert.equal(sysAdmin.isSystemAdmin, true);
  });

  await t.test("2. HO Admin (systemRole: USER) and branch users cannot access /api/admin/users", async () => {
    // HO Admin with business_role = 'admin' but system_role = 'USER'
    const hoAdminHeaders = await createAuthHeaders("usr_ho_cmu3w9j8m0100f4fkmfmryr8a");
    const hoReq = new Request("http://localhost/api/admin/users", { headers: hoAdminHeaders });

    const hoRes = await getUsersGet(hoReq);
    assert.equal(hoRes.status, 403, "HO Admin must be rejected with 403 Forbidden");
    const hoJson = await hoRes.json();
    assert.match(hoJson.error, /Forbidden/i);

    // Branch staff
    const branchHeaders = await createAuthHeaders("usr_local_test_staff_01");
    // If not in DB, will return 403 / unauthenticated
    const branchReq = new Request("http://localhost/api/admin/users", { headers: branchHeaders });
    const branchRes = await getUsersGet(branchReq);
    assert.equal(branchRes.status, 403, "Branch staff must be rejected with 403 Forbidden");
  });

  await t.test("3. Existing user representations and no duplication", async () => {
    const { rows: users } = await pool.query("SELECT * FROM users");
    const userIds = users.map((u) => u.id);
    const uniqueIds = new Set(userIds);
    assert.equal(userIds.length, uniqueIds.size, "User IDs must be strictly unique");

    const hoSsoUsers = users.filter((u) => u.source === "SPARTA_SSO");
    assert.equal(hoSsoUsers.length, 24, "Expected exactly 24 SPARTA_SSO Head Office users");
  });

  await t.test("4 & 5. 8 HO Management maintain instructions, 16 HO Monitoring are denied", async () => {
    const { rows: hoUsers } = await pool.query(
      "SELECT id, name, email, business_role, scope FROM users WHERE source = 'SPARTA_SSO' ORDER BY name"
    );
    assert.equal(hoUsers.length, 24);

    const { rows: overrides } = await pool.query(
      `SELECT user_id, permission_key, effect 
       FROM user_permission_overrides 
       WHERE permission_key = 'MANAGEMENT_INSTRUCTION_CREATE' 
         AND effect = 'DENY' 
         AND revoked_at IS NULL`
    );

    const deniedUserIds = new Set(overrides.map((o) => o.user_id));
    assert.equal(deniedUserIds.size, 16, "Expected exactly 16 users with active DENY overrides");

    let allowedCount = 0;
    let deniedCount = 0;

    for (const hoUser of hoUsers) {
      const userCtx: UserContext = {
        id: hoUser.id,
        name: hoUser.name,
        systemRole: "USER",
        role: hoUser.business_role,
        scope: hoUser.scope,
        branch: null,
      };

      const result = await checkUserPermission({
        user: userCtx,
        permission: "MANAGEMENT_INSTRUCTION_CREATE",
      });

      if (deniedUserIds.has(hoUser.id)) {
        assert.equal(
          result.authorized,
          false,
          `User ${hoUser.name} (${hoUser.id}) must be DENIED from creating management instructions`
        );
        assert.equal(result.source, "USER_OVERRIDE_DENY");
        deniedCount++;
      } else {
        assert.equal(
          result.authorized,
          true,
          `User ${hoUser.name} (${hoUser.id}) must be ALLOWED to create management instructions`
        );
        allowedCount++;
      }
    }

    assert.equal(allowedCount, 8, "Expected 8 HO Management users to have instruction capability");
    assert.equal(deniedCount, 16, "Expected 16 HO Monitoring Saja users to be denied");
  });

  await t.test("6. System Administrator cannot be deleted, demoted, or deactivated", async () => {
    const adminHeaders = await createAuthHeaders("usr_sysadmin_01");

    // Attempt to demote System Admin
    const demoteReq = new Request("http://localhost/api/admin/users/usr_sysadmin_01", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ systemRole: "USER" }),
    });
    const demoteRes = await userPatch(demoteReq, {
      params: Promise.resolve({ id: "usr_sysadmin_01" }),
    });
    assert.equal(demoteRes.status, 400);
    const demoteJson = await demoteRes.json();
    assert.match(demoteJson.error, /Tidak dapat mencabut hak akses ADMIN/i);

    // Attempt to deactivate System Admin (usr_seed_admin)
    const deactReq = new Request("http://localhost/api/admin/users/usr_seed_admin", {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "INACTIVE" }),
    });
    const deactRes = await userPatch(deactReq, {
      params: Promise.resolve({ id: "usr_seed_admin" }),
    });
    assert.equal(deactRes.status, 400);
    const deactJson = await deactRes.json();
    assert.match(deactJson.error, /dilindungi dan tidak dapat dinonaktifkan/i);

    // Attempt to delete System Admin (usr_seed_admin)
    const deleteReq = new Request("http://localhost/api/admin/users/usr_seed_admin", {
      method: "DELETE",
      headers: adminHeaders,
    });
    const deleteRes = await userDelete(deleteReq, {
      params: Promise.resolve({ id: "usr_seed_admin" }),
    });
    assert.equal(deleteRes.status, 403);
    const deleteJson = await deleteRes.json();
    assert.match(deleteJson.error, /System ADMIN dilindungi dan tidak dapat dihapus/i);
  });

  await t.test("7. SSO users cannot have passwords changed or be deleted via SIAGA API", async () => {
    const adminHeaders = await createAuthHeaders("usr_sysadmin_01");
    const ssoUserId = "usr_ho_cmu3w9j8m0100f4fkmfmryr8a";

    // Attempt password change on SSO user
    const pwReq = new Request(`http://localhost/api/admin/users/${ssoUserId}`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ password: "NewPassword123!", confirmPassword: "NewPassword123!" }),
    });
    const pwRes = await userPatch(pwReq, {
      params: Promise.resolve({ id: ssoUserId }),
    });
    assert.equal(pwRes.status, 400);
    const pwJson = await pwRes.json();
    assert.match(pwJson.error, /Portal Login Sparta/i);

    // Attempt deletion on SSO user
    const delReq = new Request(`http://localhost/api/admin/users/${ssoUserId}`, {
      method: "DELETE",
      headers: adminHeaders,
    });
    const delRes = await userDelete(delReq, {
      params: Promise.resolve({ id: ssoUserId }),
    });
    assert.equal(delRes.status, 400);
    const delJson = await delRes.json();
    assert.match(delJson.error, /Pengguna SSO tidak dapat dihapus/i);
  });

  await t.test("8. Legacy Sync POST without special authorization returns 403", async () => {
    const adminHeaders = await createAuthHeaders("usr_sysadmin_01");

    const syncReq = new Request("http://localhost/api/admin/users/sync", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ dryRun: false }),
    });
    const syncRes = await userSyncPost(syncReq);
    assert.equal(syncRes.status, 403);
    const syncJson = await syncRes.json();
    assert.match(syncJson.error, /Mutasi sinkronisasi dataset lama dinonaktifkan/i);
  });

  await t.test("9. Live SSO Grant Batch: ACTIVE, REVOKED, and NO_GRANT mapping", async () => {
    clearGrantCache();
    const mockData = [
      {
        userId: "usr_active_01",
        moduleId: "SIAGA",
        hasGrant: true,
        status: "ACTIVE",
        role: "USER",
        grantedAt: "2026-11-01T10:00:00.000Z",
        revokedAt: null,
      },
      {
        userId: "usr_revoked_01",
        moduleId: "SIAGA",
        hasGrant: false,
        status: "REVOKED",
        role: "USER",
        grantedAt: "2026-10-01T10:00:00.000Z",
        revokedAt: "2026-11-05T12:00:00.000Z",
      },
      {
        userId: "usr_nogrant_01",
        moduleId: "SIAGA",
        hasGrant: false,
        status: "NO_GRANT",
        role: null,
        grantedAt: null,
        revokedAt: null,
      },
    ];

    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          verifiedAt: "2026-11-09T14:00:00.000Z",
          count: mockData.length,
          data: mockData,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const results = await querySpartaBatchModuleGrants(
      ["usr_active_01", "usr_revoked_01", "usr_nogrant_01"],
      { fetchFn: mockFetch as any, skipCache: true }
    );

    const activeRes = results.get("usr_active_01");
    assert.ok(activeRes);
    assert.equal(activeRes.status, "ACTIVE");
    assert.equal(activeRes.label, "Aktif");
    assert.equal(activeRes.verifiedAt, "2026-11-01T10:00:00.000Z");

    const revokedRes = results.get("usr_revoked_01");
    assert.ok(revokedRes);
    assert.equal(revokedRes.status, "REVOKED");
    assert.equal(revokedRes.label, "Dicabut / Tidak Aktif");
    assert.equal(revokedRes.verifiedAt, "2026-11-05T12:00:00.000Z");

    const noGrantRes = results.get("usr_nogrant_01");
    assert.ok(noGrantRes);
    assert.equal(noGrantRes.status, "NO_GRANT");
    assert.equal(noGrantRes.label, "Tidak Ada Grant");
  });

  await t.test("10. Fail-Safe: API timeout/error maps strictly to UNVERIFIED, NEVER to NO_GRANT", async () => {
    clearGrantCache();
    // Simulate Network Timeout (AbortError)
    const timeoutFetch = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    const resultsTimeout = await querySpartaBatchModuleGrants(["usr_sso_test_01"], {
      fetchFn: timeoutFetch as any,
      skipCache: true,
    });

    const timeoutRes = resultsTimeout.get("usr_sso_test_01");
    assert.ok(timeoutRes);
    assert.equal(timeoutRes.status, "UNVERIFIED", "Timeout must result in UNVERIFIED");
    assert.equal(timeoutRes.label, "Belum Diverifikasi");
    assert.notEqual(timeoutRes.status, "NO_GRANT", "Timeout must NEVER be misclassified as NO_GRANT");
    assert.match(timeoutRes.error || "", /batas waktu habis|timeout/i);

    // Simulate 500 Server Error
    const error500Fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Internal Server Error" } }), {
        status: 500,
        statusText: "Internal Server Error",
      });

    const results500 = await querySpartaBatchModuleGrants(["usr_sso_test_02"], {
      fetchFn: error500Fetch as any,
      skipCache: true,
    });

    const errorRes = results500.get("usr_sso_test_02");
    assert.ok(errorRes);
    assert.equal(errorRes.status, "UNVERIFIED");
    assert.equal(errorRes.label, "Belum Diverifikasi");
    assert.notEqual(errorRes.status, "NO_GRANT");
    assert.match(errorRes.error || "", /500/);
  });

  await t.test("11. Batch lookup handles hundreds of users by chunking <= 100", async () => {
    clearGrantCache();
    // Generate 250 user IDs
    const testIds = Array.from({ length: 250 }, (_, i) => `usr_batch_${i + 1}`);
    const chunkRequests: string[][] = [];

    const mockFetch = async (_url: string, init?: any) => {
      const body = JSON.parse(init.body);
      chunkRequests.push(body.userIds);

      const items = body.userIds.map((uid: string) => ({
        userId: uid,
        moduleId: "SIAGA",
        hasGrant: true,
        status: "ACTIVE",
        role: "USER",
        grantedAt: "2026-11-09T00:00:00.000Z",
      }));

      return new Response(
        JSON.stringify({
          success: true,
          verifiedAt: "2026-11-09T14:30:00.000Z",
          count: items.length,
          data: items,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const results = await querySpartaBatchModuleGrants(testIds, {
      fetchFn: mockFetch as any,
      skipCache: true,
    });

    // 250 users with chunk size 100 must produce exactly 3 requests (100, 100, 50)
    assert.equal(chunkRequests.length, 3, "Expected 3 chunk requests for 250 users");
    assert.equal(chunkRequests[0].length, 100);
    assert.equal(chunkRequests[1].length, 100);
    assert.equal(chunkRequests[2].length, 50);

    // Verify all 250 users are mapped in results
    assert.equal(results.size, 250);
    for (const uid of testIds) {
      assert.equal(results.get(uid)?.status, "ACTIVE");
    }
  });

  await t.test("12. In-memory caching preserves results and avoids redundant network calls", async () => {
    clearGrantCache();
    let networkCallCount = 0;

    const mockFetch = async () => {
      networkCallCount++;
      return new Response(
        JSON.stringify({
          success: true,
          verifiedAt: "2026-11-09T14:30:00.000Z",
          data: [
            {
              userId: "usr_cached_01",
              moduleId: "SIAGA",
              hasGrant: true,
              status: "ACTIVE",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    // First call (cache miss)
    const res1 = await querySpartaUserModuleGrant("usr_cached_01", { fetchFn: mockFetch as any });
    assert.equal(res1.status, "ACTIVE");
    assert.equal(networkCallCount, 1);

    // Second call (cache hit within 60s TTL)
    const res2 = await querySpartaUserModuleGrant("usr_cached_01", { fetchFn: mockFetch as any });
    assert.equal(res2.status, "ACTIVE");
    assert.equal(networkCallCount, 1, "Second query within TTL must not trigger another network request");
  });

  await closeDbPool();
});
