import assert from "node:assert/strict";
import test from "node:test";
import { getDbPool, closeDbPool } from "../lib/db";
import { GET as getUsersGet } from "../app/api/admin/users/route";
import { signSession } from "../lib/jwt";
import { querySpartaBatchModuleGrants } from "../lib/sso-service";

test("User Management & SSO Grant Status — System Administrator Browser UAT Simulation", async (t) => {
  const pool = getDbPool();

  async function createSessionCookie(userId: string) {
    const token = await signSession({ id: userId });
    return `siaga_session=${token}`;
  }

  await t.test("UAT-1: System Administrator Authenticated Access to /admin/users Data", async () => {
    const cookie = await createSessionCookie("usr_sysadmin_01");
    const req = new Request("http://localhost:3004/api/admin/users", {
      headers: { cookie, Accept: "application/json" },
    });

    const res = await getUsersGet(req);
    assert.equal(res.status, 200, "System Admin must receive HTTP 200");

    const json = await res.json();
    assert.ok(Array.isArray(json.data), "Response must contain users list");
    assert.ok(json.data.length >= 560, "Expected all registered users (HO + Branch + Admin)");

    // System Administrator account verification
    const sysAdmin = json.data.find((u: any) => u.id === "usr_sysadmin_01");
    assert.ok(sysAdmin, "System Administrator usr_sysadmin_01 must be present");
    assert.equal(sysAdmin.systemRole, "ADMIN");
    assert.equal(sysAdmin.classification, "SYSTEM_ADMIN");
    assert.equal(sysAdmin.ssoGrantStatus, "LOCAL");
    assert.equal(sysAdmin.ssoGrantStatusLabel, "Akun Lokal");

    // Head Office accounts verification
    const hoSsoUsers = json.data.filter((u: any) => u.source === "SPARTA_SSO");
    assert.equal(hoSsoUsers.length, 24, "Expected exactly 24 SPARTA_SSO Head Office users");

    // 8 HO Management vs 16 HO Monitoring
    const hoMgmt = hoSsoUsers.filter((u: any) => u.classification === "HO_MANAGEMENT");
    const hoMon = hoSsoUsers.filter((u: any) => u.classification === "HO_MONITORING");
    assert.equal(hoMgmt.length, 8, "Expected 8 HO Management users");
    assert.equal(hoMon.length, 16, "Expected 16 HO Monitoring Saja users");

    // Branch accounts verification
    const branchUsers = json.data.filter((u: any) => u.scope === "BRANCH");
    assert.ok(branchUsers.length >= 539, "Expected at least 539 branch operational users");
  });

  await t.test("UAT-2: Non-System Administrator Browser Access Rejected (403 Forbidden)", async () => {
    // 1. HO Admin (business_role: 'admin', system_role: 'USER')
    const hoCookie = await createSessionCookie("usr_ho_cmu3w9j8m0100f4fkmfmryr8a");
    const hoReq = new Request("http://localhost:3004/api/admin/users", {
      headers: { cookie: hoCookie, Accept: "application/json" },
    });
    const hoRes = await getUsersGet(hoReq);
    assert.equal(hoRes.status, 403, "HO Admin must be rejected with 403 Forbidden");

    // 2. Branch User
    const branchCookie = await createSessionCookie("usr_local_test_staff_01");
    const branchReq = new Request("http://localhost:3004/api/admin/users", {
      headers: { cookie: branchCookie, Accept: "application/json" },
    });
    const branchRes = await getUsersGet(branchReq);
    assert.equal(branchRes.status, 403, "Branch user must be rejected with 403 Forbidden");

    // 3. Unauthenticated request
    const anonReq = new Request("http://localhost:3004/api/admin/users", {
      headers: { Accept: "application/json" },
    });
    const anonRes = await getUsersGet(anonReq);
    assert.equal(anonRes.status, 403, "Anonymous request must be rejected with 403 Forbidden");
  });

  await t.test("UAT-3: Live Grant Status Verification & Safe Fallback", async () => {
    // Batch query with mixed grant states
    const mockGrants = [
      {
        userId: "usr_active_sso",
        moduleId: "SIAGA",
        hasGrant: true,
        status: "ACTIVE",
        role: "USER",
        grantedAt: "2026-11-01T08:00:00.000Z",
        revokedAt: null,
      },
      {
        userId: "usr_revoked_sso",
        moduleId: "SIAGA",
        hasGrant: false,
        status: "REVOKED",
        role: "USER",
        grantedAt: "2026-10-15T08:00:00.000Z",
        revokedAt: "2026-11-08T10:00:00.000Z",
      },
      {
        userId: "usr_no_grant_sso",
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
          verifiedAt: "2026-11-09T15:00:00.000Z",
          count: mockGrants.length,
          data: mockGrants,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const grantMap = await querySpartaBatchModuleGrants(
      ["usr_active_sso", "usr_revoked_sso", "usr_no_grant_sso"],
      { fetchFn: mockFetch as any, skipCache: true }
    );

    assert.equal(grantMap.get("usr_active_sso")?.status, "ACTIVE");
    assert.equal(grantMap.get("usr_active_sso")?.label, "Aktif");

    assert.equal(grantMap.get("usr_revoked_sso")?.status, "REVOKED");
    assert.equal(grantMap.get("usr_revoked_sso")?.label, "Dicabut / Tidak Aktif");

    assert.equal(grantMap.get("usr_no_grant_sso")?.status, "NO_GRANT");
    assert.equal(grantMap.get("usr_no_grant_sso")?.label, "Tidak Ada Grant");
  });

  await closeDbPool();
});
