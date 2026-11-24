import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { exchangeSpartaLaunchToken } from "../lib/sso-service";
import { fetchPortalMaster } from "../lib/sparta-master-sync";
import { parsePortalBranches, parsePortalStores } from "../lib/sparta-master-contract";
import { parseProvisioningEvent, verifyProvisioningRequest } from "../lib/sparta-provisioning";

const portal = process.env.SPARTA_PORTAL_REPO || path.resolve(process.cwd(), "..", "login-sparta");
const source = (relative: string) => pathToFileURL(path.join(portal, "apps/api/src", relative)).href;

test("SIAGA integrates with the actual login-sparta routers and provisioning worker", {
  skip: !existsSync(path.join(portal, "apps/api/src/modules/master/master.routes.ts")),
}, async t => {
  const requirePortal = createRequire(path.join(portal, "apps/api/package.json"));
  const express = requirePortal("express");
  const { createMasterRouter } = await import(source("modules/master/master.routes.ts"));
  const { createSsoRouter } = await import(source("modules/sso/sso.routes.ts"));
  const { ProvisioningWorker } = await import(source("modules/provisioning/provisioning.worker.ts"));
  const date = new Date();
  const key = "test-only-master-key";
  const env = { SPARTA_INTERNAL_API_KEY: key, SESSION_SECRET: "test-session-secret-minimum-32-characters" };
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
  const app = express();
  app.use(express.json());
  app.use("/v1/master", createMasterRouter(env, { masterRepository, storeRepository }));
  app.use("/v1/sso", createSsoRouter(env, { ssoRepository }));
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
  } finally {
    delete process.env.SPARTA_API_URL;
    delete process.env.SPARTA_INTERNAL_API_KEY;
  }
});
