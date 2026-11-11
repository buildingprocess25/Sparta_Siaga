import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { querySpartaBatchModuleGrants, clearGrantCache } from "../lib/sso-service";

test("End-to-End Cross-Service Integration & Security Scope Audit", async (t) => {
  // 1. Dynamically import createApp and SsoRepository from login-sparta
  const { createApp } = await import("file:///C:/buildingprocess25/login-sparta/apps/api/src/app.ts");

  const ADMIN_MUTATION_KEY = "admin-secret-sync-key-32characters-min";
  const READ_ONLY_GRANT_KEY = "sso-read-only-grant-key-32characters";

  const testEnv = {
    NODE_ENV: "test",
    PORT: 10000,
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/sparta_login",
    SESSION_SECRET: "test-session-secret-minimum-32-characters",
    OTP_PEPPER: "test-otp-pepper-minimum-32-characters",
    CORS_ORIGINS: ["http://localhost:5173"],
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_REFRESH_TOKEN: "google-refresh-token",
    GMAIL_USER: "no-reply@sparta.local",
    SPARTA_BUILDING_CALLBACK_URL: "https://building.sparta.local/auth/sso/callback",
    SPARTA_MAINTENANCE_CALLBACK_URL: "https://maintenance.sparta.local/auth/sso/callback",
    SPARTA_ENERGY_CALLBACK_URL: "https://energy.sparta.local/auth/sso/callback",
    SPARTA_SIAGA_CALLBACK_URL: "https://siaga.sparta-alfamart.web.id/auth/sso/callback",
    SPARTA_INTERNAL_API_KEY: ADMIN_MUTATION_KEY,
    SPARTA_SSO_READ_KEY: READ_ONLY_GRANT_KEY,
  };

  class MockSsoRepository {
    grants = new Map<string, any>();

    async findLaunchByTokenHash() {
      return null;
    }
    async consumeLaunch() {}

    async getModuleAccessBatch(userIds: string[], moduleId: string) {
      return userIds.map((userId) => {
        const key = `${userId}:${moduleId}`;
        if (this.grants.has(key)) {
          return this.grants.get(key);
        }
        return {
          userId,
          moduleId,
          hasGrant: false,
          status: "NO_GRANT",
          role: null,
          grantedAt: null,
          revokedAt: null,
          userStatus: null,
        };
      });
    }
  }

  const ssoRepo = new MockSsoRepository();
  ssoRepo.grants.set("usr_ho_active:SIAGA", {
    userId: "usr_ho_active",
    moduleId: "SIAGA",
    hasGrant: true,
    status: "ACTIVE",
    role: "USER",
    grantedAt: "2026-11-01T10:00:00.000Z",
    revokedAt: null,
    userStatus: "ACTIVE",
  });
  ssoRepo.grants.set("usr_ho_revoked:SIAGA", {
    userId: "usr_ho_revoked",
    moduleId: "SIAGA",
    hasGrant: false,
    status: "REVOKED",
    role: "USER",
    grantedAt: "2026-10-01T10:00:00.000Z",
    revokedAt: "2026-11-05T12:00:00.000Z",
    userStatus: "ACTIVE",
  });

  const app = createApp(testEnv as any, { ssoRepository: ssoRepo as any });
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as { port: number };
  const targetServerUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
  });

  await t.test("E2E-1: SIAGA calls Login Sparta batch endpoint using read-only key (200 OK)", async () => {
    clearGrantCache();
    const results = await querySpartaBatchModuleGrants(
      ["usr_ho_active", "usr_ho_revoked", "usr_ho_none"],
      {
        spartaApiUrl: targetServerUrl,
        internalApiKey: READ_ONLY_GRANT_KEY,
        skipCache: true,
      }
    );

    assert.equal(results.size, 3);

    const activeUser = results.get("usr_ho_active");
    assert.ok(activeUser);
    assert.equal(activeUser.status, "ACTIVE");
    assert.equal(activeUser.label, "Aktif");

    const revokedUser = results.get("usr_ho_revoked");
    assert.ok(revokedUser);
    assert.equal(revokedUser.status, "REVOKED");
    assert.equal(revokedUser.label, "Dicabut / Tidak Aktif");

    const noGrantUser = results.get("usr_ho_none");
    assert.ok(noGrantUser);
    assert.equal(noGrantUser.status, "NO_GRANT");
    assert.equal(noGrantUser.label, "Tidak Ada Grant");
  });

  await t.test("E2E-2: Security Isolation — Read-only key is FORBIDDEN from invoking user sync mutation (403)", async () => {
    // Attempt to invoke user sync on Login Sparta with the read-only grant key
    const syncRes = await fetch(`${targetServerUrl}/v1/admin/users/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sparta-internal-read-key": READ_ONLY_GRANT_KEY,
        "x-sparta-internal-key": READ_ONLY_GRANT_KEY,
      },
      body: JSON.stringify({
        email: "malicious.mutation@sparta.local",
        fullName: "Attacker",
        branchCode: "01",
        branchName: "Cabang",
        role: "USER",
        modules: [{ moduleId: "siaga", role: "USER" }],
      }),
    });

    assert.equal(
      syncRes.status,
      403,
      "Login Sparta MUST reject mutation requests authenticated with read-only key"
    );

    const syncJson = await syncRes.json();
    assert.equal(syncJson.error?.code, "FORBIDDEN_MUTATION_SCOPE");
    assert.match(syncJson.error?.message, /kewenangan mutasi sinkronisasi/i);
  });

  await t.test("E2E-3: Authentication Boundary — Missing or invalid keys are rejected with 401", async () => {
    // 1. Missing Key
    const missingRes = await fetch(`${targetServerUrl}/v1/sso/module-access/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId: "SIAGA", userIds: ["usr_ho_active"] }),
    });
    assert.equal(missingRes.status, 401, "Requests without internal key must return 401");

    // 2. Invalid Key
    const invalidRes = await fetch(`${targetServerUrl}/v1/sso/module-access/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sparta-internal-read-key": "bogus-random-unauthorized-key",
      },
      body: JSON.stringify({ moduleId: "SIAGA", userIds: ["usr_ho_active"] }),
    });
    assert.equal(invalidRes.status, 401, "Requests with invalid key must return 401");
  });

  await t.test("E2E-4: Topology & Network Isolation — Non-existent host returns UNVERIFIED (Never NO_GRANT)", async () => {
    clearGrantCache();
    // Simulate an unreachable internal network address (e.g. non-existent container)
    const deadHostUrl = "http://127.0.0.1:59999";
    const results = await querySpartaBatchModuleGrants(["usr_ho_active"], {
      spartaApiUrl: deadHostUrl,
      internalApiKey: READ_ONLY_GRANT_KEY,
      timeoutMs: 1000,
      skipCache: true,
    });

    const deadRes = results.get("usr_ho_active");
    assert.ok(deadRes);
    assert.equal(deadRes.status, "UNVERIFIED");
    assert.equal(deadRes.label, "Belum Diverifikasi");
    assert.notEqual(deadRes.status, "NO_GRANT");
    assert.match(deadRes.error || "", /Gagal terhubung ke Login Sparta|koneksi|refused/i);
  });
});

