import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { exchangeSpartaLaunchToken } from "../lib/sso-service";
import { fetchPortalMaster, syncBranchesFromPortal, syncStoresFromPortal } from "../lib/sparta-master-sync";
import { parsePortalBranches, parsePortalStores } from "../lib/sparta-master-contract";
import { compareFacilityMasters } from "../lib/sparta-facility-comparison";
import { applyProvisioningEvent, parseProvisioningEvent, verifyProvisioningRequest } from "../lib/sparta-provisioning";
import { reportSiagaRoleChangeToPortal } from "../lib/sparta-role-sync";
import type { UserModel } from "../lib/user-db";

const portal = process.env.SPARTA_PORTAL_REPO || path.resolve(process.cwd(), "..", "login-sparta");
const source = (relative: string) => pathToFileURL(path.join(portal, "apps/api/src", relative)).href;

test("SIAGA integrates with the actual login-sparta routers and provisioning worker", {
  skip: !existsSync(path.join(portal, "apps/api/src/modules/master/master.routes.ts")),
}, async t => {
  const requirePortal = createRequire(path.join(portal, "apps/api/package.json"));
  const express = requirePortal("express");
  const { createMasterRouter } = await import(source("modules/master/master.routes.ts"));
  const { createSsoRouter } = await import(source("modules/sso/sso.routes.ts"));
  const { createUsersRouter } = await import(source("modules/users/users.routes.ts"));
  const { ProvisioningWorker } = await import(source("modules/provisioning/provisioning.worker.ts"));
  const date = new Date();
  const key = "test-only-master-key";
  const env = { SPARTA_INTERNAL_API_KEY: key, SESSION_SECRET: "test-session-secret-minimum-32-characters", NODE_ENV: "test" };
  const masterRepository = {
    async listBranches() { return [{ code: "KZ01", name: "CIKOKOL", aliases: ["G001"], isActive: true, updatedAt: date, address: null, areaCode: null }]; },
    async listAreas() { return []; },
  };
  const storeRepository = {
    async listForSync() { return [
      { code: "T001", name: "Alfamart pengujian", branchCode: "KZ01", brand: "ALFAMART", ownershipType: "FRANCHISE", latitude: -6, longitude: 106, isActive: true, updatedAt: date },
      { code: "L001", name: "Lawson pengujian", branchCode: "KZ01", brand: "LAWSON", ownershipType: "UNKNOWN", latitude: null, longitude: null, isActive: true, updatedAt: date },
    ]; },
    async listBrands() { return [{ code: "ALFAMART", hasRule: true, moduleIds: ["SIAGA"] }, { code: "LAWSON", hasRule: true, moduleIds: ["MAINTENANCE"] }]; },
  };
  let consumed = false;
  const ssoRepository = {
    async findLaunchByTokenHash() { return { id: "launch-1", moduleId: "siaga", consumedAt: consumed ? new Date() : null,
      expiresAt: new Date(Date.now() + 120000), user: { id: "portal-1", employeeId: "123", email: "user@example.test",
        fullName: "User pengujian", branchName: "CIKOKOL", branchCode: "KZ01", access: ["siaga"] } }; },
    async consumeLaunch() { consumed = true; },
  };
  const portalUsers = [{
    id: "portal-1",
    email: "user@example.test",
    employeeId: "123",
    fullName: "User Portal Asli",
    branchCode: "KZ01",
    branchName: "CIKOKOL",
    validBranchNames: ["CIKOKOL"],
    role: "USER" as const,
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
    passwordState: "ACTIVE" as const,
    lastLoginAt: date,
    createdAt: date,
    modules: [{ moduleId: "siaga" as const, role: "BMS", isActive: true }],
  }];
  const usersRepository = {
    async listUsers() { return portalUsers; },
    async findUserById(userId: string) { return portalUsers.find(u => u.id === userId) || null; },
    async findUserByEmail(email: string) { return portalUsers.find(u => u.email === email.toLowerCase()) || null; },
    async createUser() { throw new Error("unexpected createUser"); },
    async updateUser(userId: string, input: { status?: "ACTIVE" | "INACTIVE"; validBranchNames?: string[] }) {
      const target = portalUsers.find(u => u.id === userId);
      if (target && input.status) target.status = input.status;
      if (target && input.validBranchNames) target.validBranchNames = input.validBranchNames;
    },
    async grantModuleAccess(userId: string, moduleId: string, role: string) {
      const target = portalUsers.find(u => u.id === userId);
      const access = target?.modules.find(m => m.moduleId === moduleId);
      if (access) {
        access.role = role;
        access.isActive = true;
      }
    },
    async revokeModuleAccess(userId: string, moduleId: string) {
      const target = portalUsers.find(u => u.id === userId);
      const access = target?.modules.find(m => m.moduleId === moduleId);
      if (access) access.isActive = false;
    },
    async createAuditEvent() {},
  };
  const app = express();
  app.use(express.json());
  app.use("/v1/master", createMasterRouter(env, { masterRepository, storeRepository }));
  app.use("/v1/sso", createSsoRouter(env, { ssoRepository }));
  app.use("/v1/admin/users", createUsersRouter(env, { authRepository: {} as never, usersRepository, provisioningRepository: null }));
  app.use((err: { status?: number; statusCode?: number; code?: string }, _req: unknown, res: { status: (n: number) => { json: (v: unknown) => void } }, next: () => void) => {
    if (!err) return next();
    res.status(err.status || err.statusCode || 400).json({ error: { code: err.code || "TEST_ERROR" } });
  });
  const base = "http://portal.test";
  const dispatch = (async (input, init = {}) => new Promise<Response>((resolve, reject) => {
    const url = new URL(String(input));
    const socket = new Socket();
    const request = new IncomingMessage(socket);
    request.url = url.pathname + url.search;
    request.method = init.method || "GET";
    request.headers = Object.fromEntries(new Headers(init.headers));
    const body = init.body ? Buffer.from(String(init.body)) : null;
    if (body) request.headers["content-length"] = String(body.length);
    const response = new ServerResponse(request);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error("Portal router did not respond")), 5000);
    response.write = ((chunk: string | Buffer) => { chunks.push(Buffer.from(chunk)); return true; }) as typeof response.write;
    response.end = ((chunk?: string | Buffer) => {
      clearTimeout(timer);
      if (chunk) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.getHeaders())) if (value !== undefined) headers.set(key, String(value));
      resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
      socket.destroy();
      return response;
    }) as typeof response.end;
    app.handle(request, response);
    if (body) request.push(body);
    request.push(null);
  })) as typeof fetch;
  process.env.SPARTA_API_URL = base;
  process.env.SPARTA_INTERNAL_API_KEY = key;
  try {
    await t.test("portal SSO v2 is consumed by SIAGA", async () => {
      const result = await exchangeSpartaLaunchToken("test-launch-token-at-least-20-characters", { spartaApiUrl: base, fetchFn: dispatch });
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.user.spartaUserId, "portal-1");
        assert.equal(result.user.employeeId, "123");
        assert.equal(result.user.branchCode, "KZ01");
      }
      assert.equal(consumed, true);
    });
    await t.test("SIAGA receives portal branch aliases and authorized stores", async () => {
      const branches = parsePortalBranches((await fetchPortalMaster("branches", { fetchFn: dispatch })).data);
      const full = await fetchPortalMaster("stores", { fetchFn: dispatch });
      const stores = parsePortalStores(full.data, branches);
      assert.deepEqual(branches[0].aliases, ["G001"]);
      assert.equal(stores.length, 1);
      assert.equal(stores[0].ownershipType, "FRANCHISE");
      assert.equal(stores[0].address, undefined);
      const incremental = parsePortalStores((await fetchPortalMaster("stores", { fetchFn: dispatch, updatedSince: new Date(0).toISOString() })).data, branches);
      assert.equal(incremental.find(row => row.code === "L001")?.isActive, false);
    });
    await t.test("syncBranchesFromPortal pulls official master branches from login-sparta /v1/master/branches", async () => {
      const prevFlag = process.env.SPARTA_BRANCH_MASTER_ENABLED;
      process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
      const calls: Array<{ sql: string; values: unknown[] }> = [];
      const branchClient = {
        async query(sql: string, values: unknown[] = []) {
          calls.push({ sql, values });
          if (sql.includes("AS master_schema_ready")) return { rows: [{ master_schema_ready: true }], rowCount: 1 };
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
      const branchPool = { query: branchClient.query, connect: async () => branchClient } as unknown as Pool;
      try {
        const result = await syncBranchesFromPortal({ pool: branchPool, fetchFn: dispatch });
        assert.equal(result.count, 1);
        assert.equal(result.activeCount, 1);
        const upsert = calls.find(c => c.sql.includes("INSERT INTO sparta_master_branches"))!;
        assert.equal(upsert.values[0], "KZ01");
        assert.equal(upsert.values[1], "CIKOKOL");
        assert.equal(upsert.values[2], JSON.stringify(["G001"]));
      } finally {
        if (prevFlag === undefined) delete process.env.SPARTA_BRANCH_MASTER_ENABLED;
        else process.env.SPARTA_BRANCH_MASTER_ENABLED = prevFlag;
      }
    });
    await t.test("syncStoresFromPortal executes full and incremental syncs against login-sparta /v1/master/stores", async () => {
      const prevFlag = process.env.SPARTA_BRANCH_MASTER_ENABLED;
      process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
      const calls: Array<{ sql: string; values: unknown[] }> = [];
      let savedCursor: string | null = null;
      const storeClient = {
        async query(sql: string, values: unknown[] = []) {
          calls.push({ sql, values });
          if (sql.includes("AS master_schema_ready")) return { rows: [{ master_schema_ready: true }], rowCount: 1 };
          if (sql.includes("SELECT synced_at FROM sparta_master_sync_state WHERE resource='stores'")) {
            return { rows: savedCursor ? [{ synced_at: savedCursor }] : [], rowCount: savedCursor ? 1 : 0 };
          }
          if (sql.includes("INSERT INTO stores")) {
            const batch = JSON.parse(String(values[0])) as Array<{ code: string; is_active: boolean }>;
            return { rows: batch.map(() => ({ inserted: savedCursor === null })), rowCount: batch.length };
          }
          if (sql.includes("INSERT INTO sparta_master_sync_state(resource,synced_at) VALUES('stores'")) {
            savedCursor = String(values[0]);
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
      const storePool = { query: storeClient.query, connect: async () => storeClient } as unknown as Pool;
      try {
        const fullResult = await syncStoresFromPortal({ pool: storePool, fetchFn: dispatch, confirmFull: true });
        assert.equal(fullResult.status, "COMPLETED");
        assert.equal(fullResult.records_added, 1);
        assert.ok(savedCursor);
        const fullBatch = JSON.parse(String(calls.find(c => c.sql.includes("INSERT INTO stores"))!.values[0]));
        assert.equal(fullBatch[0].code, "T001");
        assert.equal(fullBatch[0].branch_code, "KZ01");
        assert.equal(fullBatch[0].ownership_type, "FRANCHISE");

        calls.length = 0;
        const incResult = await syncStoresFromPortal({ pool: storePool, fetchFn: dispatch });
        assert.equal(incResult.status, "COMPLETED");
        assert.equal(incResult.records_updated, 2);
        const incBatch = JSON.parse(String(calls.find(c => c.sql.includes("INSERT INTO stores"))!.values[0])) as Array<{ code: string; is_active: boolean }>;
        assert.equal(incBatch.find(s => s.code === "T001")?.is_active, true);
        assert.equal(incBatch.find(s => s.code === "L001")?.is_active, false);
      } finally {
        if (prevFlag === undefined) delete process.env.SPARTA_BRANCH_MASTER_ENABLED;
        else process.env.SPARTA_BRANCH_MASTER_ENABLED = prevFlag;
      }
    });
    await t.test("compareFacilityMasters resolves SIAGA legacy branch alias against CarbonTrack code via login-sparta branches", async () => {
      const portalBranches = parsePortalBranches((await fetchPortalMaster("branches", { fetchFn: dispatch })).data);
      const result = compareFacilityMasters(
        [{ code: "DC01", name: "DC CIKOKOL", type: "DC", latitude: -6.2, longitude: 106.5, branchCode: "G001" }],
        [{ code: "DC01", name: "DC CIKOKOL", type: "DC", latitude: -6.2, longitude: 106.5, branchCode: "KZ01" }],
        { portalBranches }
      );
      assert.equal(result.matchedExactCount, 1);
      assert.equal(result.differentCount, 0);
      assert.equal(result.portalSync, "BLOCKED_NO_PORTAL_FACILITY_CONTRACT");
    });
    await t.test("portal rejects missing module ID and invalid internal API key", async () => {
      assert.equal((await dispatch(`${base}/v1/master/stores`, { headers: { "x-sparta-internal-key": key } })).status, 400);
      assert.equal((await dispatch(`${base}/v1/master/branches`)).status, 401);
    });
    await t.test("portal provisioning signatures are accepted by the SIAGA verifier", async () => {
      const secret = "test-only-provisioning-shared-secret-32";
      const payload = { eventId: "event-1", type: "access.revoked", occurredAt: date.toISOString(), moduleId: "siaga",
        user: { spartaUserId: "portal-1", employeeId: "123", email: "user@example.test", fullName: "User pengujian", branch: "CIKOKOL", branchCode: "KZ01", status: "ACTIVE" },
        access: { isActive: false, role: "BMS" } };
      let delivered = false;
      const repository = {
        async claimDue() { return [{ id: payload.eventId, moduleId: "siaga", payload, attempts: 1 }]; },
        async getProvisioningUrls() { return new Map([["siaga", "http://siaga.test/internal/sparta/provision"]]); },
        async markDelivered() { delivered = true; },
        async markFailed(_id: string, reason: string) { assert.fail(reason); },
        async markRetry(_id: string, _at: Date, reason: string) { assert.fail(reason); },
      };
      const worker = new ProvisioningWorker(repository, { secrets: { siaga: secret }, fetch: async (_url: string, init: RequestInit) => {
        const raw = String(init.body);
        const headers = new Headers(init.headers);
        verifyProvisioningRequest(raw, headers, secret);
        assert.equal(parseProvisioningEvent(JSON.parse(raw), headers.get("x-sparta-event-id")).type, "access.revoked");
        return new Response(null, { status: 200 });
      } });
      await worker.runOnce();
      assert.equal(delivered, true);
    });
    await t.test("SIAGA reports active role change to login-sparta /v1/admin/users/sync without reactivating revoked access", async () => {
      const siagaUser: UserModel = {
        id: "siaga-1",
        externalUserId: "portal-1",
        nik: "123",
        name: "User Portal Asli",
        email: "user@example.test",
        systemRole: "USER",
        businessRole: "bms",
        scope: "BRANCH",
        branch: "BALARAJA",
        branchCode: null,
        pendingPortalBranch: { branch: "CIKOKOL", branchCode: "KZ01" },
        status: "ACTIVE",
        source: "SPARTA",
        ssoStatus: "ACTIVE",
        createdAt: date.toISOString(),
        updatedAt: date.toISOString(),
      };

      const synced = await reportSiagaRoleChangeToPortal(
        siagaUser,
        { ...siagaUser, businessRole: "bmc" },
        { spartaApiUrl: base, internalApiKey: key, fetchFn: dispatch }
      );
      assert.deepEqual(synced, { status: "SYNCED", role: "BMC" });
      assert.equal(portalUsers[0].modules[0].role, "BMC");
      assert.equal(portalUsers[0].modules[0].isActive, true);
      assert.equal(portalUsers[0].fullName, "User Portal Asli");

      // Simulate Portal revoking access; SIAGA must NOT re-enable it via /sync
      portalUsers[0].modules[0].isActive = false;
      const blocked = await reportSiagaRoleChangeToPortal(
        siagaUser,
        { ...siagaUser, status: "INACTIVE", ssoStatus: "BLOCKED", businessRole: "bm" },
        { spartaApiUrl: base, internalApiKey: key, fetchFn: dispatch }
      );
      assert.deepEqual(blocked, { status: "SKIPPED", reason: "user_not_active" });
      assert.equal(portalUsers[0].modules[0].isActive, false);
      assert.equal(portalUsers[0].modules[0].role, "BMC");
    });
    await t.test("Portal user.updated via ProvisioningWorker preserves SIAGA local role and legacy branch", async () => {
      const secret = "test-only-provisioning-shared-secret-32";
      const dbCalls: Array<{ sql: string; values: unknown[] }> = [];
      const fakeClient = {
        async query(sql: string, values: unknown[] = []) {
          dbCalls.push({ sql, values });
          if (sql.startsWith("SELECT * FROM users")) {
            return {
              rows: [{
                id: "siaga-1",
                external_user_id: "portal-1",
                nik: "123",
                name: "Nama Lama",
                email: "user@example.test",
                source: "SPARTA",
                status: "ACTIVE",
                sso_status: "ACTIVE",
                system_role: "USER",
                business_role: "bmc",
                scope: "BRANCH",
                branch: "BALARAJA",
                token_version: 2,
              }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 1 };
        },
        release() {},
      };
      const fakePool = { query: fakeClient.query, connect: async () => fakeClient } as unknown as Pool;
      const workerEvent = {
        eventId: "event-user-updated-1",
        type: "user.updated" as const,
        occurredAt: new Date(date.getTime() + 1000).toISOString(),
        moduleId: "siaga" as const,
        user: { spartaUserId: "portal-1", employeeId: "123", email: "user@example.test", fullName: "Nama Baru Portal", branch: "CIKOKOL", branchCode: "KZ01", status: "ACTIVE" as const },
        access: { isActive: true, role: "BMS" },
      };
      let delivered = false;
      const worker = new ProvisioningWorker({
        async claimDue() { return [{ id: workerEvent.eventId, moduleId: "siaga", payload: workerEvent, attempts: 1 }]; },
        async getProvisioningUrls() { return new Map([["siaga", "http://siaga.test/internal/sparta/provision"]]); },
        async markDelivered() { delivered = true; },
        async markFailed(_id: string, reason: string) { assert.fail(reason); },
        async markRetry(_id: string, _at: Date, reason: string) { assert.fail(reason); },
      }, {
        secrets: { siaga: secret },
        fetch: async (_url: string, init: RequestInit) => {
          const raw = String(init.body);
          const headers = new Headers(init.headers);
          verifyProvisioningRequest(raw, headers, secret);
          const parsed = parseProvisioningEvent(JSON.parse(raw), headers.get("x-sparta-event-id"));
          await applyProvisioningEvent(parsed, { pool: fakePool });
          return new Response(null, { status: 200 });
        },
      });
      await worker.runOnce();
      assert.equal(delivered, true);
      const userUpdate = dbCalls.find(c => c.sql.startsWith("UPDATE users"))!;
      assert.equal(userUpdate.values[3], "Nama Baru Portal");
      assert.equal(userUpdate.values[11], "bmc");
      assert.equal(userUpdate.values[12], "BRANCH");
      assert.equal(userUpdate.values[13], "BALARAJA");
      assert.equal(userUpdate.values[10], 0);
    });
  } finally {
    delete process.env.SPARTA_API_URL;
    delete process.env.SPARTA_INTERNAL_API_KEY;
  }
});
