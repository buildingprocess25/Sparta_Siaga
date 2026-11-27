import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { assertReadOnlySql, getIsolatedDbPool, getProductionDbPool, getProductionReadOnlyDbPool, verifyPostgresReadOnlyPermissions, closeDbPool } from "../lib/db";
import {
  GATE_TOKEN_COOKIE,
  areSameDatabaseCredentials,
  getSpartaEnvironment,
  isDevelopmentReadOnlyMode,
  isIsolatedDatabaseTarget,
  isSimulationAllowed,
  issueGateToken,
  validateProductionDatabaseAccess,
} from "../lib/environment-policy";
import { POST as gateVerifyPost } from "../app/api/auth/gate-verify/route";
import { POST as quickLoginPost } from "../app/api/auth/quick-login/route";
import { POST as refreshPost } from "../app/api/auth/refresh/route";
import { POST as logoutPost } from "../app/api/auth/logout/route";
import { GET as envStatusGet } from "../app/api/auth/env-status/route";
import { getSessionUser } from "../lib/auth";
import { proxy } from "../proxy";
import { CompletionApprovalService } from "../lib/completion-approval-service";
import { getMilestones } from "../lib/milestone-service";
import { runAutonomousDisasterCycle, runAutonomousStoreSyncCycle, processEarthquakeAlertsAndReports } from "../lib/server-daemon";
import { applyProvisioningEvent } from "../lib/sparta-provisioning";
import { reportSiagaRoleChangeToPortal } from "../lib/sparta-role-sync";
import { sendEmergencyEmail } from "../lib/email-service";
import { dispatchEarthquakePushNotifications } from "../lib/web-push-service";

const SAVED_ENV = { ...process.env };

function enableReadOnlyDevEnv() {
  process.env.APP_ENV = "development";
  process.env.SPARTA_ENVIRONMENT = "development";
  process.env.SPARTA_DEV_DATA_MODE = "production-readonly";
  process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL =
    "postgresql://sparta_siaga_readonly:ro-pass@prod.db.internal:5432/siaga?sslmode=require";
  process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK =
    "postgresql://siaga_writer:rw-pass@prod.db.internal:5432/siaga?sslmode=require";
  process.env.DATABASE_URL = "postgresql://readonly-guard@127.0.0.1:5432/siaga_write_blocked";
  process.env.JWT_SECRET = "readonly-test-jwt-secret-minimum-32-characters-long";
  process.env.DEV_GATE_PASSCODE = "readonly-authorized-gate-passcode-123";
  process.env.SPARTA_TEST_GATE_ENABLED = "true";
  process.env.SPARTA_FORCE_DEV_GATE = "true";
}

function setMockIsolatedPool(handler: (sql: string, params: unknown[]) => Record<string, unknown>[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const rows = handler(sql, params);
      return { rows, rowCount: rows.length };
    },
    release() {},
  };
  (globalThis as unknown as { isolatedPool?: Pool }).isolatedPool = {
    query: client.query,
    connect: async () => client,
    end: async () => {},
  } as unknown as Pool;
  return calls;
}

beforeEach(() => {
  enableReadOnlyDevEnv();
});

afterEach(async () => {
  (globalThis as unknown as { isolatedPool?: Pool }).isolatedPool = undefined;
  delete (globalThis as unknown as { __spartaReadOnlyDevSessions?: Map<string, unknown> }).__spartaReadOnlyDevSessions;
  delete (globalThis as unknown as { __spartaReadOnlyRevokedUsers?: Map<string, number> }).__spartaReadOnlyRevokedUsers;
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED_ENV)) delete process.env[k];
  }
  Object.assign(process.env, SAVED_ENV);
  await closeDbPool();
});

test("assertReadOnlySql allows safe SELECT/WITH/SHOW/BEGIN READ ONLY and blocks all mutations, locks, DDL, and stacked SQL", () => {
  // Valid SELECT queries (including string literals & column names that contain write substrings)
  assert.doesNotThrow(() => assertReadOnlySql("SELECT id, updated_at, deleted_at FROM incidents WHERE status = 'UPDATE' ORDER BY created_at DESC"));
  assert.doesNotThrow(() => assertReadOnlySql("/* comment */ WITH latest AS (SELECT * FROM stores LIMIT 5) SELECT * FROM latest"));
  assert.doesNotThrow(() => assertReadOnlySql("SHOW transaction_read_only"));
  assert.doesNotThrow(() => assertReadOnlySql("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY"));
  assert.doesNotThrow(() => assertReadOnlySql("BEGIN READ ONLY"));

  const forbidden = [
    "INSERT INTO users (id) VALUES ('x')",
    "UPDATE incidents SET status = 'closed'",
    "DELETE FROM user_sessions WHERE id = '1'",
    "TRUNCATE TABLE stores",
    "CREATE TABLE foo (id int)",
    "ALTER TABLE users ADD COLUMN foo text",
    "DROP TABLE incidents",
    "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE",
    "SELECT * FROM user_sessions WHERE refresh_token_hash = $1 FOR UPDATE",
    "SELECT pg_advisory_xact_lock(7421840)",
    "SELECT pg_try_advisory_lock(123)",
    "SELECT 1; DELETE FROM users",
    "BEGIN",
    "WITH d AS (DELETE FROM incidents RETURNING id) SELECT * FROM d",
  ];
  for (const sql of forbidden) {
    assert.throws(() => assertReadOnlySql(sql), /READ_ONLY_DATABASE_VIOLATION/, `Expected block for SQL: ${sql}`);
  }
});

test("verifyPostgresReadOnlyPermissions enforces SELECT-only role and rejects privileged or write-capable roles", async () => {
  const validAudit = await verifyPostgresReadOnlyPermissions({
    async query() {
      return {
        rows: [{
          db_user: "sparta_siaga_readonly",
          tx_read_only: "on",
          is_privileged_role: false,
          has_table_write_privilege: false,
          has_schema_create_privilege: false,
        }],
      };
    },
  });
  assert.equal(validAudit.dbUser, "sparta_siaga_readonly");
  assert.equal(validAudit.txReadOnly, "on");

  const unsafeCases = [
    { db_user: "sparta_siaga_readonly", tx_read_only: "off", is_privileged_role: false, has_table_write_privilege: false, has_schema_create_privilege: false },
    { db_user: "postgres", tx_read_only: "on", is_privileged_role: true, has_table_write_privilege: false, has_schema_create_privilege: false },
    { db_user: "app_writer", tx_read_only: "on", is_privileged_role: false, has_table_write_privilege: true, has_schema_create_privilege: false },
    { db_user: "app_ddl", tx_read_only: "on", is_privileged_role: false, has_table_write_privilege: false, has_schema_create_privilege: true },
  ];
  for (const row of unsafeCases) {
    await assert.rejects(
      () => verifyPostgresReadOnlyPermissions({ async query() { return { rows: [row] }; } }),
      /FATAL_READONLY_PERMISSION_VIOLATION/
    );
  }
});

test("credential reuse between SPARTA_PRODUCTION_READONLY_DATABASE_URL and write DATABASE_URL fails closed to production", () => {
  process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL =
    "postgresql://siaga_writer:pass@prod.db.internal:5432/siaga?sslmode=require";
  process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK =
    "postgresql://siaga_writer:pass@prod.db.internal:5432/siaga?sslmode=require";

  assert.equal(
    areSameDatabaseCredentials(
      process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL,
      process.env.SPARTA_WRITE_DATABASE_URL_FOR_CHECK
    ),
    true
  );
  assert.equal(getSpartaEnvironment(), "production");
  assert.equal(isDevelopmentReadOnlyMode(), false);
  assert.equal(isSimulationAllowed(), false);
});

test("run-dev CLI switches cleanly between isolated and prod-readonly and rejects retired 'uat'", () => {
  const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
  const isoOut = execFileSync(process.execPath, [tsxCli, "scripts/run-dev.ts", "isolated", "--dry-run-env"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SPARTA_ISOLATED_TEST_DATABASE_URL: "postgresql://avn:pw@host.aivencloud.com:15196/sparta_siaga_isolated?sslmode=require",
    },
  });
  assert.match(isoOut, /"devDataMode":"isolated"/);

  const roOut = execFileSync(process.execPath, [tsxCli, "scripts/run-dev.ts", "prod-readonly", "--dry-run-env"], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://writer:pw@prod.db.internal:5432/siaga?sslmode=require",
      SPARTA_PRODUCTION_READONLY_DATABASE_URL: "postgresql://sparta_siaga_readonly:ro@prod.db.internal:5432/siaga?sslmode=require",
      DEV_GATE_PASSCODE: "readonly-cli-passcode-123456",
      DEV_BIND_HOST: "",
    },
  });
  assert.match(roOut, /"devDataMode":"production-readonly"/);
  assert.match(roOut, /"workerEnabled":"false"/);
  assert.match(roOut, /"bindHost":"127\.0\.0\.1"/);

  assert.throws(() => {
    execFileSync(process.execPath, [tsxCli, "scripts/run-dev.ts", "prod-readonly", "--dry-run-env"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://writer:pw@prod.db.internal:5432/siaga?sslmode=require",
        SPARTA_PRODUCTION_READONLY_DATABASE_URL: "postgresql://sparta_siaga_readonly:ro@prod.db.internal:5432/siaga?sslmode=require",
        DEV_GATE_PASSCODE: "short",
      },
    });
  });

  assert.throws(() => {
    execFileSync(process.execPath, [tsxCli, "scripts/run-dev.ts", "prod-readonly", "--dry-run-env"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://writer:pw@prod.db.internal:5432/siaga?sslmode=require",
        SPARTA_PRODUCTION_READONLY_DATABASE_URL: "postgresql://sparta_siaga_readonly:ro@prod.db.internal:5432/siaga?sslmode=require",
        DEV_GATE_PASSCODE: "readonly-cli-passcode-123456",
        DEV_BIND_HOST: "0.0.0.0",
      },
    });
  });

  assert.throws(() => {
    execFileSync(process.execPath, [tsxCli, "scripts/run-dev.ts", "uat", "--dry-run-env"], {
      encoding: "utf8",
    });
  });
});

test("Quick Login 9 roles, getSessionUser, refresh RTR, env-status, and logout require gate auth and execute zero DB writes in read-only mode", async () => {
  const calls = setMockIsolatedPool((sql) => {
    if (sql.includes("DISTINCT UPPER(BTRIM(cabang))")) {
      return [{ branch: "BANDUNG" }, { branch: "SEMARANG" }];
    }
    if (sql.includes("FROM stores")) {
      return [{ cabang: "SEMARANG", branch_code: "SM01" }];
    }
    return [];
  });

  // Unauthorized loopback user cannot read branch directory from Production DB or use Quick Login
  const unauthEnvRes = await envStatusGet(new Request("http://localhost:3004/api/auth/env-status", { headers: { host: "localhost:3004" } }));
  assert.equal(unauthEnvRes.status, 200);
  const unauthEnvJson = await unauthEnvRes.json();
  assert.equal(unauthEnvJson.isQuickLoginAllowed, false);
  assert.equal(unauthEnvJson.gateRequired, true);
  assert.equal(unauthEnvJson.gateEnabled, true);
  assert.deepEqual(unauthEnvJson.availableBranches, []);
  assert.equal(calls.length, 0, "Unauthorized request must not query Production DB");

  const unauthQuickRes = await quickLoginPost(new Request("http://localhost:3004/api/auth/quick-login", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3004" },
    body: JSON.stringify({ role: "bms", branch: "SEMARANG" }),
  }));
  assert.equal(unauthQuickRes.status, 403);

  const unauthPageRes = await proxy(new NextRequest("http://localhost:3004/monitoring", { headers: { host: "localhost:3004" } }));
  assert.equal(unauthPageRes.status, 307);

  // Authorized local developer passes Gate Passcode first
  const gateRes = await gateVerifyPost(new Request("http://localhost:3004/api/auth/gate-verify", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3004", origin: "http://localhost:3004" },
    body: JSON.stringify({ passcode: process.env.DEV_GATE_PASSCODE }),
  }));
  assert.equal(gateRes.status, 200);
  const gateCookie = (gateRes.headers.getSetCookie?.() || [gateRes.headers.get("set-cookie") || ""])
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith(`${GATE_TOKEN_COOKIE}=`))!;
  assert.ok(gateCookie);

  const envRes = await envStatusGet(new Request("http://localhost:3004/api/auth/env-status", {
    headers: { host: "localhost:3004", cookie: gateCookie },
  }));
  const envJson = await envRes.json();
  assert.equal(envJson.isReadOnlyMode, true);
  assert.equal(envJson.dataMode, "production-readonly");
  assert.equal(envJson.isSimulationAllowed, false);
  assert.equal(envJson.isQuickLoginAllowed, true);
  assert.deepEqual(envJson.availableBranches, ["BANDUNG", "SEMARANG"]);

  for (const role of ["sysadmin", "admin", "bm", "bmc", "bec", "bbc", "bms", "bes", "bbs"]) {
    const req = new Request("http://localhost:3004/api/auth/quick-login", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3004", cookie: gateCookie },
      body: JSON.stringify({ role, branch: "SEMARANG" }),
    });
    const res = await quickLoginPost(req);
    assert.equal(res.status, 200, `Quick login failed for role ${role}`);
    const body = await res.json();
    assert.equal(body.readOnlyMode, true);

    const setCookies = res.headers.getSetCookie?.() || [res.headers.get("set-cookie") || ""];
    const sessionCookies = setCookies.map((c) => c.split(";")[0]).join("; ");
    const cookieHeader = `${gateCookie}; ${sessionCookies}`;
    assert.ok(cookieHeader.includes("siaga_session="));
    assert.ok(cookieHeader.includes("siaga_refresh="));

    // Session cookie without gate cookie must fail in Read-Only mode
    const noGateUser = await getSessionUser(new Request("http://localhost:3004/api/auth/me", { headers: { host: "localhost:3004", cookie: sessionCookies } }));
    assert.equal(noGateUser, null);

    const user = await getSessionUser(new Request("http://localhost:3004/api/auth/me", { headers: { host: "localhost:3004", cookie: cookieHeader } }));
    assert.ok(user, `getSessionUser failed for ${role}`);
    assert.equal(user!.systemRole, role === "sysadmin" ? "ADMIN" : "USER");

    const refRes = await refreshPost(new Request("http://localhost:3004/api/auth/refresh", {
      method: "POST",
      headers: { host: "localhost:3004", cookie: cookieHeader },
    }));
    assert.equal(refRes.status, 200);
  }

  // Logout all-devices clears/invalidates in-memory session with zero DB calls
  const loginRes = await quickLoginPost(new Request("http://localhost:3004/api/auth/quick-login", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3004", cookie: gateCookie },
    body: JSON.stringify({ role: "bms", branch: "SEMARANG" }),
  }));
  const cookies = `${gateCookie}; ` + (loginRes.headers.getSetCookie?.() || [loginRes.headers.get("set-cookie") || ""])
    .map((c) => c.split(";")[0]).join("; ");

  const loRes = await logoutPost(new Request("http://localhost:3004/api/auth/logout?all=true", {
    method: "POST",
    headers: { host: "localhost:3004", cookie: cookies },
  }));
  assert.equal(loRes.status, 200);
  const afterLogout = await getSessionUser(new Request("http://localhost:3004/api/auth/me", { headers: { host: "localhost:3004", cookie: cookies } }));
  assert.equal(afterLogout, null, "Revoked in-memory session must fail after logout?all=true");

  assert.ok(calls.every((c) => /^\s*SELECT\b/i.test(c.sql)), `Unexpected non-SELECT query during auth lifecycle: ${JSON.stringify(calls)}`);
});

test("Development Read-Only blocks public tunnels, proxy forwarding headers, and unauthorized loopback access", async () => {
  const gateCookie = `${GATE_TOKEN_COOKIE}=${issueGateToken()}`;
  const tunnelCases: Array<{ label: string; url: string; headers: Record<string, string> }> = [
    {
      label: "devtunnels host",
      url: "https://demo.devtunnels.ms",
      headers: { host: "demo.devtunnels.ms", cookie: gateCookie },
    },
    {
      label: "localtunnel host",
      url: "https://demo.loca.lt",
      headers: { host: "demo.loca.lt", cookie: gateCookie },
    },
    {
      label: "forwarded header on localhost",
      url: "http://localhost:3004",
      headers: { host: "localhost:3004", "x-forwarded-for": "127.0.0.1", cookie: gateCookie },
    },
    {
      label: "cloudflare proxy header on localhost",
      url: "http://localhost:3004",
      headers: { host: "localhost:3004", "cf-ray": "abc123", cookie: gateCookie },
    },
  ];

  for (const tc of tunnelCases) {
    for (const p of ["/login", "/monitoring", "/api/auth/quick-login", "/api/health/live", "/api/incidents"]) {
      const pRes = await proxy(new NextRequest(`${tc.url}${p}`, { headers: tc.headers }));
      assert.equal(pRes.status, 403, `proxy must block ${tc.label} on ${p}`);
      const pBody = await pRes.json();
      assert.equal(pBody.code, "READ_ONLY_TUNNEL_FORBIDDEN");
    }

    const envRes = await envStatusGet(new Request(`${tc.url}/api/auth/env-status`, { headers: tc.headers }));
    assert.equal(envRes.status, 403, `env-status must block ${tc.label}`);
    const gateRes = await gateVerifyPost(new Request(`${tc.url}/api/auth/gate-verify`, {
      method: "POST",
      headers: { ...tc.headers, "content-type": "application/json" },
      body: JSON.stringify({ passcode: process.env.DEV_GATE_PASSCODE }),
    }));
    assert.equal(gateRes.status, 403, `gate-verify must block ${tc.label}`);
    const qlRes = await quickLoginPost(new Request(`${tc.url}/api/auth/quick-login`, {
      method: "POST",
      headers: { ...tc.headers, "content-type": "application/json" },
      body: JSON.stringify({ role: "bms", branch: "BANDUNG" }),
    }));
    assert.equal(qlRes.status, 403, `quick-login must block ${tc.label}`);
    const sessionUser = await getSessionUser(new Request(`${tc.url}/api/auth/me`, { headers: tc.headers }));
    assert.equal(sessionUser, null, `getSessionUser must reject ${tc.label}`);
  }
});

test("proxy and service guards block writes, simulation, provisioning, workers, and notifications in read-only mode", async () => {
  const blockedEndpoints: Array<{ method: string; url: string }> = [
    { method: "POST", url: "http://localhost:3004/api/incidents" },
    { method: "POST", url: "http://localhost:3004/api/simulation/earthquake/trigger" },
    { method: "GET", url: "http://localhost:3004/api/simulation/status" },
    { method: "POST", url: "http://localhost:3004/internal/sparta/provision" },
    { method: "POST", url: "http://localhost:3004/api/notifications/worker" },
    { method: "GET", url: "http://localhost:3004/api/incidents/expiration" },
    { method: "POST", url: "http://localhost:3004/api/stores/sync" },
    { method: "POST", url: "http://localhost:3004/api/integrations/v1/work-updates" },
    { method: "PATCH", url: "http://localhost:3004/api/admin/users/usr_1" },
  ];

  for (const ep of blockedEndpoints) {
    const res = await proxy(new NextRequest(ep.url, { method: ep.method, headers: { host: "localhost:3004" } }));
    assert.equal(res.status, 403, `Expected 403 for ${ep.method} ${ep.url}`);
    const body = await res.json();
    assert.equal(body.code, "READ_ONLY_DEV_MODE");
  }

  // Quick login endpoint requires verified gate on loopback, then passes
  const qlBlocked = await proxy(new NextRequest("http://localhost:3004/api/auth/quick-login", {
    method: "POST",
    headers: { host: "localhost:3004" },
  }));
  assert.equal(qlBlocked.status, 403);

  const qlPass = await proxy(new NextRequest("http://localhost:3004/api/auth/quick-login", {
    method: "POST",
    headers: { host: "localhost:3004", cookie: `${GATE_TOKEN_COOKIE}=${issueGateToken()}` },
  }));
  assert.notEqual(qlPass.status, 403);

  assert.throws(() => getProductionDbPool(), /FATAL_DATABASE_SAFETY_VIOLATION/);

  // Lazy read-path DB synthesis uses ZERO INSERT / CREATE TABLE queries
  const calls = setMockIsolatedPool((sql) => {
    if (sql.includes("FROM incidents") && sql.includes("WHERE i.id = $1")) {
      return [{
        id: "INC-RO-1",
        date: "2026-11-26",
        disaster_type: "flood",
        store_id: "T001",
        store_name: "Toko Satu",
        branch: "BANDUNG",
        location_city: "Bandung",
        status: "in_maintenance",
        progress: 50,
        timeline: [],
        created_at: "2026-11-26T00:00:00.000Z",
        updated_at: "2026-11-26T00:00:00.000Z",
      }];
    }
    return [];
  });

  const approval = await CompletionApprovalService.getOrCreateApproval("INC-RO-1");
  assert.equal(approval.id, "ro_appr_INC-RO-1");
  const milestones = await getMilestones("INC-RO-1");
  assert.equal(milestones.length, 5);
  assert.ok(milestones.every((m) => m.id.startsWith("ro_ms_")));
  assert.ok(!calls.some((c) => /CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM/i.test(c.sql)));

  // Worker / sync / notification / provisioning service-level hard blocks
  await runAutonomousDisasterCycle();
  const syncRes = await runAutonomousStoreSyncCycle(true);
  assert.equal(syncRes.status, "READ_ONLY_BLOCKED");
  const alertRes = await processEarthquakeAlertsAndReports([], []);
  assert.deepEqual(alertRes, { dispatchedAlerts: 0, createdReports: 0 });

  await assert.rejects(
    () => applyProvisioningEvent({
      eventId: "e-ro",
      type: "access.granted",
      occurredAt: new Date().toISOString(),
      moduleId: "siaga",
      user: { spartaUserId: "u1", employeeId: null, email: "a@b.test", fullName: "A", branch: "BDG", branchCode: "BDG", status: "ACTIVE" },
      access: { isActive: true, role: "bms" },
    }),
    { code: "READ_ONLY_DEV_MODE" }
  );

  const roleSyncRes = await reportSiagaRoleChangeToPortal(
    { systemRole: "USER", businessRole: "bms", status: "ACTIVE", ssoStatus: "ACTIVE", source: "SPARTA", externalUserId: "p1" },
    {
      id: "u1", externalUserId: "p1", nik: "1", name: "U", email: "a@b.test",
      systemRole: "USER", businessRole: "bm", scope: "BRANCH", branch: "BANDUNG",
      branchCode: "BZ01", status: "ACTIVE", source: "SPARTA", ssoStatus: "ACTIVE",
      createdAt: "", updatedAt: "",
    }
  );
  assert.deepEqual(roleSyncRes, { status: "SKIPPED", reason: "read_only_mode" });

  const emailRes = await sendEmergencyEmail({ to: "x@y.test", subject: "s", html: "h", branch: "BANDUNG" });
  assert.equal(emailRes.status, "suppressed_testing_mode");

  const pushRes = await dispatchEarthquakePushNotifications({ title: "t", body: "b", branch: "BANDUNG", eventId: "eq1" });
  assert.equal(pushRes.attempted, 0);
});

test("pnpm dev defaults to isolated runner and invalid env configs never connect to operational Production DB", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { scripts?: Record<string, string> };
  assert.equal(pkg.scripts?.dev, "tsx scripts/run-dev.ts isolated");

  const runInvalidEnvCase = (envPatch: Record<string, string | undefined>) => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      APP_ENV: "production",
      SPARTA_ENVIRONMENT: "production",
      SPARTA_DEV_DATA_MODE: "",
      SPARTA_PRODUCTION_READONLY_DATABASE_URL: "",
      SPARTA_WRITE_DATABASE_URL_FOR_CHECK: "",
      ALLOW_PRODUCTION_TEST_RUN: "true",
      DATABASE_URL: "postgresql://writer:pw@prod.db.internal:5432/siaga?sslmode=require",
    });
    for (const [k, v] of Object.entries(envPatch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const access = validateProductionDatabaseAccess();
    assert.equal(access.allowed, false);
    assert.throws(() => getProductionDbPool(), /FATAL_DATABASE_SAFETY_VIOLATION/);
  };

  // Legacy 'uat', mismatched flags, development pointing to prod DB, or invalid dev data mode
  runInvalidEnvCase({ APP_ENV: "uat", SPARTA_ENVIRONMENT: "uat" });
  runInvalidEnvCase({ APP_ENV: "development", SPARTA_ENVIRONMENT: "development" });
  runInvalidEnvCase({ APP_ENV: "development", SPARTA_ENVIRONMENT: "production" });
  runInvalidEnvCase({ APP_ENV: "development", SPARTA_ENVIRONMENT: "development", SPARTA_DEV_DATA_MODE: "production-readonly", SPARTA_PRODUCTION_READONLY_DATABASE_URL: "" });
  runInvalidEnvCase({
    APP_ENV: "development",
    SPARTA_ENVIRONMENT: "development",
    SPARTA_DEV_DATA_MODE: "production-readonly",
    SPARTA_PRODUCTION_READONLY_DATABASE_URL: "postgresql://writer:pw@prod.db.internal:5432/siaga?sslmode=require",
  });
  runInvalidEnvCase({ APP_ENV: "development", SPARTA_ENVIRONMENT: "development", SPARTA_DEV_DATA_MODE: "bogus" });
  runInvalidEnvCase({ NODE_ENV: "development", APP_ENV: "production", SPARTA_ENVIRONMENT: "production" });

  // Read-only pool strictly rejects missing or reused credentials without falling back to DATABASE_URL
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  process.env.APP_ENV = "development";
  process.env.SPARTA_ENVIRONMENT = "development";
  process.env.SPARTA_DEV_DATA_MODE = "production-readonly";
  process.env.SPARTA_PRODUCTION_READONLY_DATABASE_URL = "";
  process.env.DATABASE_URL = "postgresql://writer:pw@prod.db.internal:5432/siaga?sslmode=require";
  assert.throws(() => getProductionReadOnlyDbPool(), /FATAL_DATABASE_SAFETY_VIOLATION/);

  // ALLOW_PRODUCTION_TEST_RUN bypass is eliminated: test context never accesses Production pool
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  process.env.APP_ENV = "production";
  process.env.SPARTA_ENVIRONMENT = "production";
  process.env.SPARTA_DEV_DATA_MODE = "";
  process.env.ALLOW_PRODUCTION_TEST_RUN = "true";
  assert.throws(() => getProductionDbPool(), /FATAL_DATABASE_SAFETY_VIOLATION/);

  // Isolated pool enforces the exact same Aiven target validation as run-dev.ts
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  for (const invalidIsolated of [
    "postgresql://user:pw@localhost:5432/sparta_siaga_isolated?sslmode=require",
    "postgresql://user:pw@host.aivencloud.com:15196/siaga?sslmode=require",
    "postgresql://user:pw@host.aivencloud.com:15196/sparta_siaga_isolated?sslmode=require&options=evil",
  ]) {
    (globalThis as unknown as { isolatedPool?: Pool }).isolatedPool = undefined;
    process.env.SPARTA_ISOLATED_TEST_DATABASE_URL = invalidIsolated;
    assert.equal(isIsolatedDatabaseTarget(invalidIsolated), false);
    assert.throws(() => getIsolatedDbPool(), /FATAL_DATABASE_SAFETY_VIOLATION/);
  }
  assert.equal(
    isIsolatedDatabaseTarget("postgresql://avn:pw@host.aivencloud.com:15196/sparta_siaga_isolated?sslmode=require"),
    true
  );

  // Explicit valid production environment policy check is permitted
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  assert.deepEqual(validateProductionDatabaseAccess(), { allowed: true });
});
