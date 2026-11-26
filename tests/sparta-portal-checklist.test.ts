import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import {
  canUseLocalPassword,
  detectPortalIdentityFieldChanges,
  isLocalEmergencySystemAdmin,
  isPortalManagedUser,
  selectSpartaIdentity,
  shouldRevokeUserSessionsOnUpdate,
} from "../lib/sparta-identity";
import { parsePortalBranches, parsePortalStores, resolvePortalBranch, portalStoresEnabled, type PortalBranch } from "../lib/sparta-master-contract";
import { applyProvisioningEvent, initialProvisioningRole, parseProvisioningEvent, verifyProvisioningRequest, type ProvisioningEvent } from "../lib/sparta-provisioning";
import { backfillPortalBranches, fetchPortalMaster, MASTER_SYNC_ADVISORY_LOCK_ID, previewPortalStores, syncBranchesFromPortal, syncStoresFromPortal } from "../lib/sparta-master-sync";
import { WORKER_DISASTER_ADVISORY_LOCK_ID, WORKER_STORE_SYNC_ADVISORY_LOCK_ID } from "../lib/server-daemon";
import { exchangeSpartaLaunchToken, matchSsoIdentityToSiagaUser, querySpartaBatchModuleGrants } from "../lib/sso-service";
import { compareFacilityMasters } from "../lib/sparta-facility-comparison";
import { getStoreOwnership, getStoreOwnershipLabel } from "../types/store";
import { evaluateEarthquakeV1MmiWorkflow } from "../lib/earthquake-v1-mmi-service";
import { canActOnReport, type UserContext } from "../lib/report-permissions";
import { getReportAccessSql } from "../lib/report-access-policy";
import type { IncidentRecord } from "../types/incident";
import { POST as provisionPost } from "../app/internal/sparta/provision/route";
import { GET as adminUsersGet, POST as adminUsersPost } from "../app/api/admin/users/route";
import { PATCH as adminUserPatch, DELETE as adminUserDelete } from "../app/api/admin/users/[id]/route";
import { signSession } from "../lib/jwt";

import {
  evaluatePortalRoleSyncEligibility,
  reportSiagaRoleChangeToPortal,
} from "../lib/sparta-role-sync";
import type { UserModel } from "../lib/user-db";
import { branchSqlKey, branchSqlParameter } from "../lib/sparta-rollout";
import { assignIncidentPicForPersistedAction } from "../lib/incident-assignment";

beforeEach(() => {
  delete process.env.SPARTA_BRANCH_MASTER_ENABLED;
  process.env.SPARTA_API_URL = "http://portal.test";
  process.env.SPARTA_INTERNAL_API_KEY = "test-master-key";
});

const now = Date.now();
const timestamp = Math.floor(now / 1000);
const secret = "test-only-provisioning-secret-32-characters";
const branch: PortalBranch = { code: "KZ01", name: "CIKOKOL", aliases: ["CABANG CIKOKOL", "G001"], isActive: true, updatedAt: new Date(now).toISOString() };
const store = { code: "T968", name: "Toko pengujian", branchCode: "KZ01", ownershipType: "FRANCHISE", latitude: -6.2, longitude: 106.5, isActive: true, updatedAt: new Date(now).toISOString() };
function event(patch: Partial<ProvisioningEvent> = {}): ProvisioningEvent {
  return { eventId: "event-test", type: "access.granted", occurredAt: new Date(now).toISOString(), moduleId: "siaga",
    user: { spartaUserId: "portal-1", employeeId: "123", email: "user@example.test", fullName: "User pengujian",
      branch: "CIKOKOL", branchCode: "KZ01", status: "ACTIVE" }, access: { isActive: true, role: "BMS" }, ...patch };
}
function signed(raw: string, time = timestamp) {
  return new Headers({ "x-sparta-event-id": "event-test", "x-sparta-timestamp": String(time),
    "x-sparta-signature": "sha256=" + createHmac("sha256", secret).update(`${time}.${raw}`).digest("hex") });
}

type Call = { sql: string; values: unknown[] };
function database(respond: (sql: string, values: unknown[]) => Record<string, unknown>[] = () => [], legacyNames = ["CIKOKOL"]) {
  const calls: Call[] = [];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    const rows = sql.startsWith("SELECT DISTINCT branch AS name") ? legacyNames.map(name => ({ name })) : respond(sql, values);
    return { rows: !rows.length && sql.includes("AS master_schema_ready") ? [{ master_schema_ready: true }] : rows, rowCount: 1 };
  }, release() {} };
  return { calls, pool: { query: client.query, connect: async () => client } as unknown as Pool };
}
function existingUser(patch: Record<string, unknown> = {}) {
  return { id: "siaga-1", external_user_id: "portal-1", nik: "123", email: "user@example.test", name: "User lama",
    source: "SPARTA", status: "ACTIVE", sso_status: "ACTIVE", system_role: "USER", business_role: "bes",
    scope: "BRANCH", branch: "Nama lama", branch_code: "KZ01", token_version: 2, ...patch };
}
function masterFetch(stores: unknown[] = [store]): typeof fetch {
  return (async input => Response.json({ data: String(input).includes("/branches") ? [branch] : stores,
    meta: { syncedAt: new Date(now).toISOString(), count: String(input).includes("/branches") ? 1 : stores.length } })) as typeof fetch;
}

test("SSO links by stable portal ID even when email changes", () => {
  const user = existingUser();
  assert.equal(selectSpartaIdentity([user], { spartaUserId: "portal-1", email: "new@example.test" })?.id, user.id);
});
test("SSO falls back to NIK then normalized email", () => {
  const user = existingUser({ external_user_id: null });
  assert.equal(selectSpartaIdentity([user], { spartaUserId: "portal-1", employeeId: "123" })?.id, user.id);
  assert.equal(selectSpartaIdentity([user], { email: " USER@EXAMPLE.TEST " })?.id, user.id);
});
test("cross-account identity conflicts are rejected", () => {
  assert.throws(() => selectSpartaIdentity([existingUser(), existingUser({ id: "other", external_user_id: "portal-2", nik: "456", email: "other@example.test" })],
    { spartaUserId: "portal-1", email: "other@example.test" }), /beberapa akun/);
});
test("fallback cannot replace an already linked portal ID", () => {
  assert.throws(() => selectSpartaIdentity([existingUser()], { spartaUserId: "portal-2", employeeId: "123" }), /ID portal lain/);
});
test("portal IDs are case sensitive", () => {
  assert.equal(selectSpartaIdentity([existingUser()], { spartaUserId: "PORTAL-1" }), null);
});
test("verified SSO v2 binds an existing unlinked account without changing local permissions", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser({ external_user_id: null })] : sql.includes("RETURNING external_user_id") ? [{ external_user_id: "portal-1" }] : []);
  const result = await matchSsoIdentityToSiagaUser({ spartaUserId: "portal-1", employeeId: "123", email: "user@example.test", access: ["siaga"] }, { pool: db.pool });
  assert.equal(result.status, "MATCHED");
  if (result.status === "MATCHED") { assert.equal(result.user.externalUserId, "portal-1"); assert.equal(result.user.businessRole, "bes"); }
  assert.ok(db.calls.some(call => call.sql.includes("SET external_user_id=$2")));
  assert.ok(!db.calls.some(call => /SET.*business_role/.test(call.sql)));
});
test("new portal user cannot activate before local scope assignment", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser({ scope: null, status: "INACTIVE", sso_status: "PENDING_SSO_GRANT" })] : []);
  const result = await matchSsoIdentityToSiagaUser({ spartaUserId: "portal-1", access: ["siaga"] }, { pool: db.pool });
  assert.equal(result.status, "PENDING_REVIEW");
  assert.ok(!db.calls.some(call => call.sql.startsWith("UPDATE users")));
});
test("LOCAL password transition is explicit and never enables portal accounts", () => {
  assert.equal(canUseLocalPassword("LOCAL", true, false), false);
  assert.equal(canUseLocalPassword("LOCAL", true, true), true);
  assert.equal(canUseLocalPassword("SPARTA", true, true), false);
  assert.equal(canUseLocalPassword("SSO", false, true), false);
});
test("branch mapping uses official code, name, then normalized aliases", () => {
  assert.equal(resolvePortalBranch("KZ01", [branch]), "KZ01");
  assert.equal(resolvePortalBranch(" cikokol ", [branch]), "KZ01");
  assert.equal(resolvePortalBranch(" cabang   cikokol ", [branch]), "KZ01");
  assert.equal(resolvePortalBranch("G001", [branch]), "KZ01");
  assert.equal(resolvePortalBranch("unknown", [branch]), null);
});
test("ambiguous aliases cannot be used for backfill", () => {
  assert.throws(() => resolvePortalBranch("G001", [branch, { ...branch, code: "BZ01", name: "BANDUNG" }]), /ambigu/);
});
test("malformed branches and repeated codes are rejected", () => {
  assert.throws(() => parsePortalBranches([{ ...branch, aliases: [42] }]));
  assert.throws(() => parsePortalBranches([branch, branch]));
});
test("store types retain UNKNOWN and nullable coordinates", () => {
  assert.equal(parsePortalStores([{ ...store, ownershipType: null, latitude: null, longitude: null }], [branch])[0].ownershipType, null);
  assert.equal(getStoreOwnership(null), "UNKNOWN");
  assert.equal(getStoreOwnershipLabel("UNKNOWN"), "Belum diketahui");
  assert.equal(getStoreOwnershipLabel("FRANCHISE"), "Franchise");
  assert.equal(getStoreOwnershipLabel("F"), "Franchise");
});
test("invalid coordinates, ownership, and branches abort store sync", () => {
  for (const patch of [{ latitude: 91 }, { longitude: NaN }, { ownershipType: "F" }, { branchCode: "UNKNOWN" }]) {
    assert.throws(() => parsePortalStores([{ ...store, ...patch }], [branch]));
  }
});
test("report permissions use branch code across different legacy names", () => {
  const user = { id: "u", name: "u", role: "bms", systemRole: "USER", scope: "BRANCH", branch: "Cabang lama", branchCode: "KZ01" } as UserContext;
  const report = { branch: "CIKOKOL", branchCode: "KZ01" } as IncidentRecord;
  assert.equal(canActOnReport(user, report), true);
  assert.equal(canActOnReport(user, { ...report, branchCode: "BZ01" }), false);
  assert.equal(canActOnReport({ ...user, branch: null, branchCode: null }, { branch: "" } as IncidentRecord), false);
});
test("provisioning accepts a valid raw-body signature", () => {
  const raw = JSON.stringify(event());
  assert.doesNotThrow(() => verifyProvisioningRequest(raw, signed(raw), secret, now));
});
test("report list SQL isolates portal branches while preserving legacy scope", () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const user = { systemRole: "USER", scope: "BRANCH", branch: "Nama lama", branchCode: "KZ01" } as UserContext;
  assert.deepEqual(getReportAccessSql(user), { clause: "incidents.branch_code = $1", values: ["KZ01"] });
  assert.match(getReportAccessSql({ ...user, branchCode: null }).clause, /LOWER\(TRIM\(incidents.branch\)\)/);
  assert.equal(getReportAccessSql({ ...user, branchCode: null, branch: null }).clause, "FALSE");
});
test("provisioning rejects modified bodies, expired timestamps, and missing secrets", () => {
  const raw = JSON.stringify(event());
  assert.throws(() => verifyProvisioningRequest(raw + " ", signed(raw), secret, now), /tanda tangan/i);
  assert.throws(() => verifyProvisioningRequest(raw, signed(raw, timestamp - 301), secret, now), /timestamp/i);
  assert.throws(() => verifyProvisioningRequest(raw, signed(raw), undefined, now), /secret/i);
});
test("provisioning checks module, header identity, event time and role catalog", () => {
  assert.equal(parseProvisioningEvent(event(), "event-test", now).moduleId, "siaga");
  assert.throws(() => parseProvisioningEvent({ ...event(), moduleId: "energy" }, "event-test", now));
  assert.throws(() => parseProvisioningEvent(event(), "different", now));
  assert.throws(() => parseProvisioningEvent({ ...event(), occurredAt: new Date(now + 3600000).toISOString() }, "event-test", now));
  assert.equal(initialProvisioningRole("BMS"), "bms");
  assert.throws(() => initialProvisioningRole("SYSTEM_ADMIN"));
  assert.throws(() => initialProvisioningRole("tim_toko"));
});
test("invalid provisioning request is rejected by the HTTP handler before any database access", async () => {
  const previous = process.env.SPARTA_PROVISIONING_SECRET;
  process.env.SPARTA_PROVISIONING_SECRET = secret;
  try {
    const response = await provisionPost(new Request("http://localhost/internal/sparta/provision", { method: "POST", body: "{}" }));
    assert.equal(response.status, 401);
  } finally { if (previous === undefined) delete process.env.SPARTA_PROVISIONING_SECRET; else process.env.SPARTA_PROVISIONING_SECRET = previous; }
});
test("new provisioning activates a branch user with portal role and derived scope without a password", async () => {
  const db = database(sql => sql.startsWith("SELECT code") ? [{ code: "KZ01" }] : []);
  const result = await applyProvisioningEvent(event(), { pool: db.pool });
  assert.equal(result.result, "applied");
  assert.equal(result.requiresLocalScope, false);
  const insert = db.calls.find(call => call.sql.includes("INSERT INTO users"))!;
  assert.match(insert.sql, /'ACTIVE','SPARTA','ACTIVE'/);
  assert.equal(insert.values[5], "bms");
  assert.equal(insert.values[6], "BRANCH");
  assert.equal(insert.values[7], "CIKOKOL");
  assert.ok(!insert.sql.includes("password_hash"));
});
test("new user resolves the portal alias to a legacy branch without converting existing records", async () => {
  const db = database(undefined, ["G001"]);
  await applyProvisioningEvent(event(), { pool: db.pool, fetchFn: masterFetch() });
  assert.equal(db.calls.find(call => call.sql.includes("INSERT INTO users"))!.values[7], "G001");
  assert.ok(!db.calls.some(call => /UPDATE stores|UPDATE incidents|UPDATE sparta_master_branches/.test(call.sql)));
});
test("unmapped new branch rolls back instead of granting an arbitrary branch", async () => {
  const db = database(undefined, ["UNMAPPED"]);
  await assert.rejects(applyProvisioningEvent(event(), { pool: db.pool, fetchFn: masterFetch() }), /padanan/);
  assert.equal(db.calls.at(-1)?.sql, "ROLLBACK");
  assert.ok(!db.calls.some(call => call.sql.includes("INSERT INTO users")));
});
test("HO grant derives HO scope without requiring a branch", async () => {
  const e = event();
  e.access.role = "ADMIN";
  e.user.branch = "";
  const db = database();
  await applyProvisioningEvent(e, { pool: db.pool });
  const insert = db.calls.find(call => call.sql.includes("INSERT INTO users"))!;
  assert.equal(insert.values[6], "HO");
  assert.equal(insert.values[7], null);
  assert.match(insert.sql, /'USER'/);
});
test("user.updated with an explicit active grant catches up a previously missing user", async () => {
  const db = database();
  await applyProvisioningEvent(event({ type: "user.updated" }), { pool: db.pool });
  assert.ok(db.calls.some(call => call.sql.includes("INSERT INTO users")));
});
test("role change restores a revoked user and invalidates their old tokens", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser({ status: "INACTIVE", sso_status: "BLOCKED" })] : []);
  await applyProvisioningEvent(event(), { pool: db.pool });
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.deepEqual(update.values.slice(7, 9), ["ACTIVE", "ACTIVE"]);
  assert.equal(update.values[10], 1);
});
test("unknown incoming role cannot replace an existing user's role", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser()] : []);
  await assert.rejects(applyProvisioningEvent(event({ access: { isActive: true, role: "SUPER_ADMIN" } }), { pool: db.pool }), /katalog/);
  assert.equal(db.calls.at(-1)?.sql, "ROLLBACK");
});
test("active legacy accounts also require a valid role and branch at SSO login", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser({ branch: null })] : []);
  assert.equal((await matchSsoIdentityToSiagaUser({ spartaUserId: "portal-1", access: ["siaga"] }, { pool: db.pool })).status, "PENDING_REVIEW");
});
test("oversized provisioning bodies are rejected before signature and database work", async () => {
  const response = await provisionPost(new Request("http://localhost/internal/sparta/provision", { method: "POST", body: "x".repeat(65537) }));
  assert.equal(response.status, 413);
});
test("access.granted applies the portal role and revokes old sessions without changing permission tables", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser()] : sql.startsWith("SELECT code") ? [{ code: "KZ01" }] : []);
  await applyProvisioningEvent(event({ type: "access.granted" }), { pool: db.pool });
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.equal(update.values[11], "bms");
  assert.equal(update.values[12], "BRANCH");
  assert.equal(update.values[10], 1);
  assert.ok(db.calls.some(call => call.sql.startsWith("UPDATE user_sessions")));
  assert.ok(!db.calls.some(call => /(?:UPDATE|INSERT INTO|DELETE FROM) (?:role_permissions|user_permission_overrides)/.test(call.sql)));
});
test("user.updated preserves local business_role, scope, and legacy branch without overwriting permission tables", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser({ business_role: "bmc", scope: "BRANCH", branch: "CABANG LAMA" })] : []);
  await applyProvisioningEvent(event({ type: "user.updated", access: { isActive: true, role: "ADMIN" } }), { pool: db.pool });
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.equal(update.values[11], "bmc");
  assert.equal(update.values[12], "BRANCH");
  assert.equal(update.values[13], "CABANG LAMA");
  assert.equal(update.values[10], 0);
  assert.ok(!db.calls.some(call => call.sql.startsWith("UPDATE user_sessions")));
  assert.ok(!db.calls.some(call => /(?:UPDATE|INSERT INTO|DELETE FROM) (?:role_permissions|user_permission_overrides)/.test(call.sql)));
});
test("deactivation and revoke both invalidate active device sessions", async () => {
  for (const type of ["user.deactivated", "access.revoked"] as const) {
    const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser()] : []);
    await applyProvisioningEvent(event({ type }), { pool: db.pool });
    const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
    assert.equal(update.values[7], "INACTIVE");
    assert.equal(update.values[8], "BLOCKED");
    assert.equal(update.values[10], 1);
    assert.ok(db.calls.some(call => call.sql.startsWith("UPDATE user_sessions SET is_revoked=TRUE")));
  }
});
test("stale events are ignored without user updates", async () => {
  const db = database(sql => sql.includes("SELECT occurred_at") ? [{ occurred_at: new Date(now + 1) }] : []);
  assert.equal((await applyProvisioningEvent(event(), { pool: db.pool })).reason, "stale_event");
  assert.ok(!db.calls.some(call => call.sql.startsWith("UPDATE users")));
});
test("revoking an unknown user records a checkpoint against late grants", async () => {
  const db = database();
  assert.equal((await applyProvisioningEvent(event({ type: "access.revoked" }), { pool: db.pool })).reason, "unknown_user");
  assert.ok(db.calls.some(call => call.sql.includes("INSERT INTO sparta_provisioning_state")));
});
test("missing provisioning schema rolls back with an actionable retryable error", async () => {
  const db = database(sql => {
    if (sql.includes("SELECT occurred_at")) throw Object.assign(new Error("missing relation"), { code: "42P01" });
    return [];
  });
  await assert.rejects(applyProvisioningEvent(event(), { pool: db.pool }),
    (error: unknown) => (error as { code: string; status: number }).code === "PROVISIONING_SCHEMA_NOT_READY" &&
      (error as { status: number }).status === 503);
  assert.equal(db.calls.at(-1)?.sql, "ROLLBACK");
});
test("conflicting identities roll back provisioning", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser(), existingUser({ id: "u2", external_user_id: "p2" })] : []);
  await assert.rejects(() => applyProvisioningEvent(event(), { pool: db.pool }), /beberapa akun/);
  assert.equal(db.calls.at(-1)?.sql, "ROLLBACK");
});
test("branch dry-run reports unmatched values without writing", async () => {
  const db = database(sql => (sql.includes("FROM users") || sql.includes("FROM incidents")) && sql.includes(" AS value") ? [{ value: "UNKNOWN", count: 1 }] : []);
  process.env.SPARTA_API_URL = "http://portal.test";
  process.env.SPARTA_INTERNAL_API_KEY = "test-master-key";
  const result = await backfillPortalBranches({ pool: db.pool, fetchFn: masterFetch() });
  assert.equal(result.applied, false);
  assert.equal(result.unmapped.length, 2);
  assert.ok(!db.calls.some(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql)));
});
test("branch apply is all-or-nothing when aliases remain missing", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database(sql => sql.includes("SELECT cabang AS value") ? [{ value: "UNKNOWN", count: 2 }] : []);
  const result = await backfillPortalBranches({ pool: db.pool, fetchFn: masterFetch(), apply: true });
  assert.equal(result.applied, false);
  assert.equal(result.unmapped.length, 1);
  assert.ok(!db.calls.some(call => call.sql.startsWith("UPDATE")));
});
test("successful branch apply updates only codes and never incident snapshots", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database(sql => sql.includes(" AS value") ? [{ value: "G001", count: 1 }] : []);
  assert.equal((await backfillPortalBranches({ pool: db.pool, fetchFn: masterFetch(), apply: true })).applied, true);
  const writes = db.calls.filter(call => call.sql.startsWith("UPDATE") && !call.sql.startsWith("UPDATE sparta_master_branches"));
  assert.equal(writes.length, 6);
  assert.ok(writes.every(call => !call.sql.includes("snapshot")));
});
test("store sync sends moduleId and internal API key", async () => {
  await fetchPortalMaster("stores", { fetchFn: (async (input, init) => {
    assert.equal(new URL(String(input)).searchParams.get("moduleId"), "siaga");
    assert.equal((init?.headers as Record<string, string>)["x-sparta-internal-key"], "test-master-key");
    return Response.json({ data: [store], meta: { count: 1, syncedAt: new Date(now).toISOString() } });
  }) as typeof fetch });
});
test("store sync preserves local store ID, contacts and missing portal address", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database(sql => sql.includes("INSERT INTO stores") ? [{ inserted: false }] : []);
  const result = await syncStoresFromPortal({ pool: db.pool, fetchFn: masterFetch(), full: true, confirmFull: true });
  assert.equal(result.records_updated, 1);
  const upsert = db.calls.find(call => call.sql.includes("INSERT INTO stores"))!;
  const update = upsert.sql.split("DO UPDATE SET")[1];
  assert.ok(!/\bid\s*=|branch_emergency_contact\s*=/.test(update));
  assert.match(update, /alamat=COALESCE\(EXCLUDED.alamat,stores.alamat\)/);
  const batch = JSON.parse(upsert.values[0] as string);
  assert.equal(batch[0].address, null);
  assert.equal(batch[0].ownership_type, "FRANCHISE");
  assert.ok(db.calls.some(call => call.sql.includes("status='COMPLETED'")));
});
test("incremental sync advances cursor only after successful writes", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database(sql => sql.includes("SELECT synced_at") ? [{ synced_at: new Date(now - 1000) }] : []);
  await syncStoresFromPortal({ pool: db.pool, fetchFn: masterFetch([]) });
  assert.ok(!db.calls.some(call => call.sql.includes("WHERE NOT (kode_toko")));
  assert.ok(db.calls.some(call => call.sql.includes("INSERT INTO sparta_master_sync_state")));
  assert.equal(db.calls.at(-1)?.sql, "COMMIT");
});
test("large store masters are written in bounded batches", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const data = Array.from({ length: 1001 }, (_, i) => ({ ...store, code: `T${i}` }));
  const db = database((sql, values) => sql.includes("INSERT INTO stores") ? JSON.parse(values[0] as string).map(() => ({ inserted: true })) : []);
  const result = await syncStoresFromPortal({ pool: db.pool, fetchFn: masterFetch(data), full: true, confirmFull: true });
  assert.equal(result.records_added, 1001);
  assert.deepEqual(db.calls.filter(call => call.sql.includes("INSERT INTO stores")).map(call => JSON.parse(call.values[0] as string).length), [500, 500, 1]);
});
test("failed store sync rolls back and logs failure without advancing cursor", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database();
  await assert.rejects(() => syncStoresFromPortal({ pool: db.pool, fetchFn: masterFetch([{ ...store, latitude: 100 }]), confirmFull: true }));
  assert.ok(db.calls.some(call => call.sql === "ROLLBACK"));
  assert.ok(db.calls.some(call => call.sql.includes("status='FAILED'")));
  assert.ok(!db.calls.some(call => call.sql.includes("INSERT INTO sparta_master_sync_state")));
});
test("facility comparison reports differences without choosing a master source", () => {
  const a = { code: "DC01", name: "DC", type: "DC", latitude: -6, longitude: 106, branchCode: "KZ01" };
  const result = compareFacilityMasters([a], [{ ...a, latitude: -6.1 }]);
  assert.deepEqual(result.different[0].fields, ["latitude"]);
  assert.equal(result.sourceDecision, "PENDING_AGREEMENT");
  assert.throws(() => compareFacilityMasters([a, a], []), /berulang/);
});
test("SSO exchange reads portal v2 while keeping v1 compatibility", async () => {
  for (const user of [{ spartaUserId: "portal-1", employeeId: "123", branchCode: "KZ01", contractVersion: 2 }, {}]) {
    const result = await exchangeSpartaLaunchToken("test-token", { fetchFn: (async () => Response.json({ data: { user: {
      email: "user@example.test", fullName: "User pengujian", access: ["siaga"], ...user,
    } } })) as typeof fetch });
    assert.equal(result.success, true);
    if (result.success && "spartaUserId" in user) assert.equal(result.user.externalUserId, "portal-1");
  }
});


test("early provisioning preserves the legacy branch and sessions for an unchanged role", async () => {
  const db = database(sql => {
    if (/sparta_master_branches/.test(sql)) assert.fail("Early provisioning must not require branch master");
    return sql.startsWith("SELECT * FROM users") ? [existingUser({ branch: "BALARAJA", branch_code: undefined })] : [];
  });
  await applyProvisioningEvent(event({ type: "user.updated", access: { isActive: true, role: "BES" } }), { pool: db.pool });
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.match(update.sql, /pending_portal_branch=/);
  assert.equal(update.values[13], "BALARAJA");
  assert.ok(!/\bbranch_code\s*=/.test(update.sql));
  assert.equal(update.values[10], 0);
  assert.ok(!db.calls.some(call => /UPDATE user_sessions/.test(call.sql)));
});
test("early new user provisioning assigns an existing legacy branch automatically", async () => {
  const db = database();
  await applyProvisioningEvent(event(), { pool: db.pool });
  const insert = db.calls.find(call => call.sql.includes("INSERT INTO users"))!;
  assert.equal(insert.values[6], "BRANCH");
  assert.equal(insert.values[7], "CIKOKOL");
  assert.equal(JSON.parse(insert.values[8] as string).branchCode, "KZ01");
  assert.ok(!db.calls.some(call => /sparta_master_branches|\bbranch_code\b/.test(call.sql)));
});
test("conversion is blocked before database or portal access while stage flag is off", async () => {
  const db = database();
  const fetchFn = (async () => { assert.fail("Portal must not be called"); }) as typeof fetch;
  await assert.rejects(() => backfillPortalBranches({ apply: true, pool: db.pool, fetchFn }), /tahap terakhir/);
  await assert.rejects(() => syncStoresFromPortal({ pool: db.pool, fetchFn, full: true, confirmFull: true }), /tahap terakhir/);
  assert.equal(db.calls.length, 0);
});
test("portal store configuration cannot silently fall back to the old sync when the stage flag is off", () => {
  const previous = process.env.STORE_MASTER_SOURCE;
  process.env.STORE_MASTER_SOURCE = "portal";
  try { assert.throws(() => portalStoresEnabled(), /sync sumber lama diblokir/); }
  finally { if (previous === undefined) delete process.env.STORE_MASTER_SOURCE; else process.env.STORE_MASTER_SOURCE = previous; }
});
test("inactive former code resolves to the active portal branch alias", () => {
  const old = { ...branch, code: "CIKOKOL", name: "CIKOKOL LAMA", aliases: [], isActive: false };
  assert.equal(resolvePortalBranch("CIKOKOL", [old, { ...branch, name: "CIKOKOL BARU", aliases: ["CIKOKOL"] }]), "KZ01");
  assert.equal(resolvePortalBranch("CIKOKOL", [old]), null);
  assert.equal(parsePortalStores([{ ...store, branchCode: "CIKOKOL" }], [old, { ...branch, aliases: ["CIKOKOL"] }])[0].branchCode, "KZ01");
});
test("full sync requires confirmation even with the final stage enabled", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database();
  await assert.rejects(() => syncStoresFromPortal({ pool: db.pool, fetchFn: masterFetch() }), /preview/);
  assert.ok(!db.calls.some(call => /INSERT INTO stores|UPDATE stores|INSERT INTO sparta_master_sync_state/.test(call.sql)));
});
test("missing portal key stops sync before connecting or recording history", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  delete process.env.SPARTA_INTERNAL_API_KEY;
  const db = database();
  await assert.rejects(() => syncStoresFromPortal({ pool: db.pool, full: true, confirmFull: true }), /Environment belum diisi: SPARTA_INTERNAL_API_KEY/);
  assert.equal(db.calls.length, 0);
});
test("missing final-stage schema stops writes before history, cursor and branch locks", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = database(sql => sql.includes("AS master_schema_ready") ? [{ master_schema_ready: false }] : []);
  await assert.rejects(() => syncStoresFromPortal({ pool: db.pool, full: true, confirmFull: true }), /Schema tahap akhir belum lengkap/);
  await assert.rejects(() => backfillPortalBranches({ pool: db.pool, apply: true, fetchFn: masterFetch() }), /Schema tahap akhir belum lengkap/);
  assert.ok(db.calls.every(call => call.sql.startsWith("SELECT")));
});
test("store preview reports deactivations and never writes with the final stage off", async () => {
  const db = database(() => [{ kode_toko: "OLD", is_active: true }, { kode_toko: store.code, is_active: true }]);
  const result = await previewPortalStores({ pool: db.pool, fetchFn: masterFetch() });
  assert.equal(result.mode, "preview");
  assert.equal(result.matched, 1);
  assert.equal(result.added, 0);
  assert.deepEqual(result.deactivate, ["OLD"]);
  assert.equal(result.missingPortalAddress, 1);
  assert.ok(db.calls.every(call => /^SELECT/.test(call.sql)));
});
test("early incident assignment uses legacy SQL without master functions or new columns", async () => {
  const queries: string[] = [];
  const result = await assignIncidentPicForPersistedAction({ query: async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith("SELECT primary")) return { rows: [{ branch: "BALARAJA", primary_pic_user_id: null, location_kind: "STORE" }] };
    if (sql.includes("AS same_branch")) return { rows: [{ same_branch: true }] };
    return { rows: [] };
  } }, { incidentId: "i", userId: "u", branch: "BALARAJA", role: "bms", action: "test" });
  assert.equal(result.assigned, true);
  assert.ok(queries.every(sql => !/sparta_branch_key|sparta_resolve_branch/.test(sql)));
  assert.equal(branchSqlKey("i.branch"), "LOWER(TRIM(i.branch))");
  assert.equal(branchSqlParameter("$2"), "LOWER(TRIM($2::text))");
  assert.match(getReportAccessSql({ systemRole: "USER", scope: "BRANCH", branch: "BALARAJA", branchCode: "KZ01" }).clause, /LOWER\(TRIM\(incidents.branch\)\)/);
});
test("default migration plan defers 018, 020, and 021 and excludes the deprecated combined migration", () => {
  const output = execFileSync(process.execPath, ["scripts/migrate-production.mjs", "--plan"], { encoding: "utf8" });
  assert.match(output, /DEFERRED 018_user_sync_metadata_and_sso_status\.sql/);
  assert.match(output, /DEFERRED 020_sparta_user_provisioning_stage\.sql/);
  assert.match(output, /DEFERRED 021_sparta_master_conversion_stage\.sql/);
  assert.ok(!output.includes("019_sparta_portal_master_and_provisioning.sql"));
  assert.equal(existsSync("database/migrations/019_sparta_portal_master_and_provisioning.sql"), false);
  const early = readFileSync("database/migrations/020_sparta_user_provisioning_stage.sql", "utf8");
  assert.ok(!/ALTER TABLE (?:stores|incidents)|TRIGGER|UPDATE |\bbranch_code\b/.test(early));
  assert.match(readFileSync("database/migrations/021_sparta_master_conversion_stage.sql", "utf8"), /WHERE b.is_active AND CASE tier/);
});
test("HO user granted BRANCH role resolves legacy branch and revokes sessions when branch master is off", async () => {
  const db = database(
    sql => sql.startsWith("SELECT * FROM users")
      ? [existingUser({ scope: "HO", business_role: "admin", branch: null, branch_code: undefined })]
      : [],
    ["G001"]
  );
  await applyProvisioningEvent(event({ type: "access.granted", access: { isActive: true, role: "BMS" } }), { pool: db.pool, fetchFn: masterFetch() });
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.equal(update.values[10], 1);
  assert.equal(update.values[11], "bms");
  assert.equal(update.values[12], "BRANCH");
  assert.equal(update.values[13], "G001");
  assert.ok(db.calls.some(call => call.sql.startsWith("UPDATE user_sessions SET is_revoked=TRUE")));
});
test("BRANCH user granted HO role clears branch and revokes sessions", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users")
    ? [existingUser({ scope: "BRANCH", business_role: "bms", branch: "BALARAJA", branch_code: undefined })]
    : []);
  const e = event({ type: "access.granted", access: { isActive: true, role: "ADMIN" } });
  e.user.branch = "";
  await applyProvisioningEvent(e, { pool: db.pool });
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.equal(update.values[10], 1);
  assert.equal(update.values[11], "admin");
  assert.equal(update.values[12], "HO");
  assert.equal(update.values[13], null);
  assert.ok(db.calls.some(call => call.sql.startsWith("UPDATE user_sessions SET is_revoked=TRUE")));
});
test("reportSiagaRoleChangeToPortal reports active role change without reactivating revoked or inactive accounts", async () => {
  const baseUser: UserModel = {
    id: "siaga-1",
    externalUserId: "portal-1",
    nik: "123",
    name: "User Pengujian",
    email: "user@example.test",
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "BALARAJA",
    branchCode: null,
    pendingPortalBranch: { branch: "BALARAJA", branchCode: "G001" },
    status: "ACTIVE",
    source: "SPARTA",
    ssoStatus: "ACTIVE",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };

  let capturedRequest: { headers: Headers; payload: Record<string, unknown> } | null = null;
  const okFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedRequest = {
      headers: new Headers(init?.headers),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return Response.json({ data: { spartaUserId: "portal-1" } });
  }) as typeof fetch;

  const synced = await reportSiagaRoleChangeToPortal(
    baseUser,
    { ...baseUser, businessRole: "bmc" },
    { fetchFn: okFetch }
  );
  assert.deepEqual(synced, { status: "SYNCED", role: "BMC" });
  const branchRequest = capturedRequest as { headers: Headers; payload: Record<string, unknown> } | null;
  assert.equal(branchRequest?.headers.get("x-sparta-internal-key"), "test-master-key");
  assert.deepEqual(branchRequest?.payload, {
    email: "user@example.test",
    employeeId: "123",
    fullName: "User Pengujian",
    branchCode: "G001",
    branchName: "BALARAJA",
    role: "BMC",
    moduleId: "siaga",
  });

  // HO user falls back to pendingPortalBranch when local branch is null
  const hoSynced = await reportSiagaRoleChangeToPortal(
    baseUser,
    {
      ...baseUser,
      businessRole: "admin",
      scope: "HO",
      branch: null,
      pendingPortalBranch: { branch: "HEAD OFFICE", branchCode: "KZ01" },
    },
    { fetchFn: okFetch }
  );
  assert.deepEqual(hoSynced, { status: "SYNCED", role: "ADMIN" });
  const hoRequest = capturedRequest as { headers: Headers; payload: Record<string, unknown> } | null;
  assert.equal(hoRequest?.payload.branchCode, "KZ01");
  assert.equal(hoRequest?.payload.branchName, "HEAD OFFICE");

  // Anti-reactivation guards: NEVER call Portal /sync when inactive, deactivating, or ssoStatus !== ACTIVE
  let antiReactivationCalls = 0;
  const blockedFetch = (async () => {
    antiReactivationCalls += 1;
    return Response.json({});
  }) as typeof fetch;

  const inactivePrev = await reportSiagaRoleChangeToPortal(
    { ...baseUser, status: "INACTIVE" },
    { ...baseUser, status: "ACTIVE", businessRole: "bmc" },
    { fetchFn: blockedFetch }
  );
  assert.deepEqual(inactivePrev, { status: "SKIPPED", reason: "user_not_active" });

  const deactivatingNext = await reportSiagaRoleChangeToPortal(
    baseUser,
    { ...baseUser, status: "INACTIVE", businessRole: "bmc" },
    { fetchFn: blockedFetch }
  );
  assert.deepEqual(deactivatingNext, { status: "SKIPPED", reason: "user_not_active" });

  const revokedAccess = await reportSiagaRoleChangeToPortal(
    baseUser,
    { ...baseUser, ssoStatus: "BLOCKED", businessRole: "bmc" },
    { fetchFn: blockedFetch }
  );
  assert.deepEqual(revokedAccess, { status: "SKIPPED", reason: "portal_access_not_active" });

  const unchanged = await reportSiagaRoleChangeToPortal(baseUser, { ...baseUser }, { fetchFn: blockedFetch });
  assert.deepEqual(unchanged, { status: "SKIPPED", reason: "role_unchanged" });

  const localOnly = await reportSiagaRoleChangeToPortal(
    baseUser,
    { ...baseUser, source: "LOCAL", externalUserId: null, businessRole: "bmc" },
    { fetchFn: blockedFetch }
  );
  assert.deepEqual(localOnly, { status: "SKIPPED", reason: "local_user" });

  assert.equal(antiReactivationCalls, 0);

  const failed = await reportSiagaRoleChangeToPortal(
    baseUser,
    { ...baseUser, businessRole: "bmc" },
    { fetchFn: (async () => Response.json({ error: { message: "Portal maintenance" } }, { status: 503 })) as typeof fetch }
  );
  assert.deepEqual(failed, { status: "FAILED", statusCode: 503, message: "Portal maintenance" });

  const missingBranchEligibility = evaluatePortalRoleSyncEligibility(baseUser, {
    ...baseUser,
    businessRole: "bmc",
    branchCode: null,
    pendingPortalBranch: null,
  });
  assert.deepEqual(missingBranchEligibility, { eligible: false, reason: "missing_portal_branch" });
});
test("querySpartaBatchModuleGrants returns UNVERIFIED without calling unavailable portal batch endpoint", async () => {
  let called = false;
  const fetchFn = (async () => { called = true; return new Response(null, { status: 404 }); }) as typeof fetch;
  const results = await querySpartaBatchModuleGrants(["portal-1", "portal-2"], { fetchFn, skipCache: true });
  assert.equal(called, false);
  assert.equal(results.get("portal-1")?.status, "UNVERIFIED");
  assert.equal(results.get("portal-1")?.verifiedAt, null);
  assert.equal(results.get("portal-2")?.status, "UNVERIFIED");
});
test("portal identity ownership policy rejects mutating name, nik, or email while allowing local accounts", () => {
  assert.equal(isPortalManagedUser({ source: "SPARTA", externalUserId: null }), true);
  assert.equal(isPortalManagedUser({ source: "SPARTA_SSO", externalUserId: null }), true);
  assert.equal(isPortalManagedUser({ source: "LOCAL", externalUserId: "portal-1" }), true);
  assert.equal(isPortalManagedUser({ source: "LOCAL", externalUserId: null }), false);
  assert.deepEqual(
    detectPortalIdentityFieldChanges(
      { name: "Andi", nik: "1001", email: "andi@sparta.local" },
      { name: " Andi ", nik: "1001", email: "ANDI@SPARTA.LOCAL" }
    ),
    []
  );
  assert.deepEqual(
    detectPortalIdentityFieldChanges(
      { name: "Andi", nik: "1001", email: "andi@sparta.local" },
      { name: "Budi", nik: "1002", email: "budi@sparta.local" }
    ),
    ["name", "nik", "email"]
  );
});
test("session revocation triggers on status, role, scope, branch, systemRole, or password change", () => {
  const base = { systemRole: "USER", businessRole: "bms", scope: "BRANCH", branch: "BANDUNG", status: "ACTIVE" };
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base }), false);
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base, status: "INACTIVE" }), true);
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base, businessRole: "bmc" }), true);
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base, scope: "HO", branch: null }), true);
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base, branch: "CIKOKOL" }), true);
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base, systemRole: "ADMIN" }), true);
  assert.equal(shouldRevokeUserSessionsOnUpdate(base, { ...base, passwordChanged: true }), true);
});
test("a missing portal export is reported before any database connection", () => {
  assert.throws(() => execFileSync(process.execPath,
    ["--import", "tsx", "scripts/sparta-portal-readiness.ts", "--portal-users=scratch/nonexistent-portal-export-for-test.json"],
    { encoding: "utf8", stdio: "pipe" }), (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr);
      assert.match(stderr, /PORTAL_EXPORT_NOT_FOUND/);
      assert.ok(!/ENOTFOUND|ECONNREFUSED|FATAL_DATABASE/.test(stderr));
      return true;
    });
});
test("provisioning preserves existing NIK via COALESCE when Portal sends employeeId: null", async () => {
  const db = database(sql => sql.startsWith("SELECT * FROM users") ? [existingUser({ nik: "20240001" })] : []);
  await applyProvisioningEvent(
    event({ type: "user.updated", user: { ...event().user, employeeId: null } }),
    { pool: db.pool }
  );
  const update = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.match(update.sql, /nik=COALESCE\(\$3,\s*nik\)/);
  assert.equal(update.values[2], null);

  db.calls.length = 0;
  await applyProvisioningEvent(
    event({ eventId: "event-test-2", type: "user.updated", occurredAt: new Date(now + 1000).toISOString(),
      user: { ...event().user, employeeId: "20249999" } }),
    { pool: db.pool }
  );
  const updateWithNik = db.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.equal(updateWithNik.values[2], "20249999");
});
test("initialProvisioningRole allows only the 8 active selectable roles and rejects legacy roles", () => {
  for (const role of ["admin", "bm", "bms", "bmc", "bes", "bec", "bbs", "bbc"]) {
    assert.equal(initialProvisioningRole(role.toUpperCase()), role);
  }
  for (const rejected of ["ho_admin", "gm_ho", "sm_ho", "tim_toko", "rekanan", "USER", "SYSTEM_ADMIN"]) {
    assert.throws(() => initialProvisioningRole(rejected), /katalog/);
  }
});
test("selectSpartaIdentity allows legacy non-admin LOCAL relinking while protecting SSO and ADMIN links", () => {
  const localLegacy = existingUser({ source: "LOCAL", system_role: "USER", external_user_id: "usr_legacy_01" });
  assert.equal(
    selectSpartaIdentity([localLegacy], { spartaUserId: "portal-new", email: "user@example.test" }, { allowLegacyLocalRelink: true })?.id,
    localLegacy.id
  );
  assert.throws(
    () => selectSpartaIdentity([localLegacy], { spartaUserId: "portal-new", email: "user@example.test" }),
    /ID portal lain/
  );
  assert.throws(
    () => selectSpartaIdentity(
      [existingUser({ source: "SPARTA_SSO", system_role: "USER", external_user_id: "portal-old" })],
      { spartaUserId: "portal-new", email: "user@example.test" },
      { allowLegacyLocalRelink: true }
    ),
    /ID portal lain/
  );
  assert.throws(
    () => selectSpartaIdentity(
      [existingUser({ source: "LOCAL", system_role: "ADMIN", external_user_id: "adm0001" })],
      { spartaUserId: "portal-new", email: "user@example.test" },
      { allowLegacyLocalRelink: true }
    ),
    /ID portal lain/
  );
});
test("provisioning protects local emergency SYSTEM_ADMIN from deactivation or mutation", async () => {
  const db = database(sql =>
    sql.startsWith("SELECT * FROM users")
      ? [existingUser({ id: "usr_sysadmin_01", source: "LOCAL", system_role: "ADMIN", external_user_id: "portal-1", business_role: null, scope: null, branch: null })]
      : []
  );
  const result = await applyProvisioningEvent(
    event({ type: "access.revoked", access: { isActive: false, role: "ADMIN" } }),
    { pool: db.pool }
  );
  assert.deepEqual(result, { result: "ignored", reason: "protected_system_admin" });
  assert.ok(!db.calls.some(call => call.sql.startsWith("UPDATE users") || call.sql.startsWith("UPDATE user_sessions")));
  assert.ok(db.calls.some(call => call.sql.includes("INSERT INTO sparta_provisioning_state")));
});
test("branch master mode clears branch and branch_code on BRANCH->HO and updates both on branch change", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const dbToHo = database(sql =>
    sql.startsWith("SELECT * FROM users")
      ? [existingUser({ scope: "BRANCH", business_role: "bms", branch: "CIKOKOL", branch_code: "KZ01" })]
      : []
  );
  const hoGrant = event({ type: "access.granted", access: { isActive: true, role: "ADMIN" } });
  hoGrant.user.branch = "HEAD OFFICE";
  hoGrant.user.branchCode = "HEAD";
  await applyProvisioningEvent(hoGrant, { pool: dbToHo.pool });
  assert.ok(dbToHo.calls.some(call => call.sql.includes("UPDATE users SET branch=NULL,branch_code=NULL")));
  assert.ok(dbToHo.calls.some(call => call.sql.startsWith("UPDATE user_sessions SET is_revoked=TRUE")));

  const dbBranchChange = database(sql =>
    sql.startsWith("SELECT * FROM users")
      ? [existingUser({ scope: "BRANCH", business_role: "bms", branch: "BANDUNG", branch_code: "BZ01" })]
      : sql.startsWith("SELECT code FROM sparta_master_branches")
        ? [{ code: "KZ01" }]
        : []
  );
  await applyProvisioningEvent(event({ type: "user.updated" }), { pool: dbBranchChange.pool });
  assert.ok(dbBranchChange.calls.some(call => call.sql.includes("UPDATE users SET branch=$2,branch_code=$3") && call.values[2] === "KZ01"));
  assert.ok(dbBranchChange.calls.some(call => call.sql.startsWith("UPDATE user_sessions SET is_revoked=TRUE")));
});
test("centralized admin user APIs block operational CRUD while preserving read-only listing and emergency admin rotation", async () => {
  const prevSecret = process.env.JWT_SECRET;
  const prevTestMode = process.env.SPARTA_TEST_MODE;
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-jwt-secret-minimum-32-characters";
  process.env.SPARTA_TEST_MODE = "true";
  const g = globalThis as unknown as { isolatedPool?: Pool };
  const prevPool = g.isolatedPool;

  const sysAdminRow = {
    id: "usr_sysadmin_01",
    external_user_id: null,
    nik: "0001",
    name: "System Admin",
    email: "siaga@admin.com",
    system_role: "ADMIN",
    business_role: null,
    scope: null,
    branch: null,
    branch_code: null,
    status: "ACTIVE",
    source: "LOCAL",
    sso_status: null,
    token_version: 2,
    created_at: new Date(now),
    updated_at: new Date(now),
  };
  const opUserRow = {
    ...sysAdminRow,
    id: "usr_sso_01",
    external_user_id: "portal-1",
    nik: "123",
    name: "User SSO",
    email: "user@example.test",
    system_role: "USER",
    business_role: "bms",
    scope: "BRANCH",
    branch: "CIKOKOL",
    source: "SPARTA",
    sso_status: "ACTIVE",
  };
  const localUserRow = { ...opUserRow, id: "usr_local_01", external_user_id: null, source: "LOCAL", sso_status: null };

  const queries: string[] = [];
  const mockClient = {
    async query(sql: string, values: unknown[] = []) {
      queries.push(sql);
      if (sql.includes("FROM users WHERE id = $1")) {
        const id = values[0];
        const row = id === "usr_sysadmin_01" ? sysAdminRow : id === "usr_sso_01" ? opUserRow : id === "usr_local_01" ? localUserRow : null;
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.includes("FROM users ORDER BY")) {
        return { rows: [sysAdminRow, opUserRow], rowCount: 2 };
      }
      if (sql.includes("FROM user_permission_overrides")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE users SET")) {
        return { rows: [{ ...sysAdminRow, token_version: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  g.isolatedPool = {
    query: mockClient.query,
    connect: async () => mockClient,
  } as unknown as Pool;

  try {
    const token = await signSession({ id: "usr_sysadmin_01" });
    const headers = { cookie: `siaga_session=${token}`, "Content-Type": "application/json" };

    const getRes = await adminUsersGet(new Request("http://localhost/api/admin/users", { headers }));
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.meta.centralizedInPortal, true);
    assert.match(getJson.meta.portalUserManagementUrl, /#\/manajemen-user$/);

    const postRes = await adminUsersPost(new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Baru" }),
    }));
    assert.equal(postRes.status, 403);
    assert.equal((await postRes.json()).code, "PORTAL_USER_MANAGEMENT_REQUIRED");

    const patchOpRes = await adminUserPatch(
      new Request("http://localhost/api/admin/users/usr_sso_01", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ businessRole: "bmc", branch: "BANDUNG", status: "INACTIVE" }),
      }),
      { params: Promise.resolve({ id: "usr_sso_01" }) }
    );
    assert.equal(patchOpRes.status, 400);
    assert.equal((await patchOpRes.json()).code, "PORTAL_USER_MANAGEMENT_REQUIRED");

    const delLocalRes = await adminUserDelete(
      new Request("http://localhost/api/admin/users/usr_local_01", { method: "DELETE", headers }),
      { params: Promise.resolve({ id: "usr_local_01" }) }
    );
    assert.equal(delLocalRes.status, 400);
    assert.equal((await delLocalRes.json()).code, "PORTAL_USER_MANAGEMENT_REQUIRED");

    const adminDemoteRes = await adminUserPatch(
      new Request("http://localhost/api/admin/users/usr_sysadmin_01", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ systemRole: "USER" }),
      }),
      { params: Promise.resolve({ id: "usr_sysadmin_01" }) }
    );
    assert.equal(adminDemoteRes.status, 400);
    assert.match((await adminDemoteRes.json()).error, /Tidak dapat mencabut hak akses ADMIN/i);

    const adminPwRes = await adminUserPatch(
      new Request("http://localhost/api/admin/users/usr_sysadmin_01", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ password: "NewEmergencyPassword123!", confirmPassword: "NewEmergencyPassword123!" }),
      }),
      { params: Promise.resolve({ id: "usr_sysadmin_01" }) }
    );
    assert.equal(adminPwRes.status, 200);
    assert.ok(queries.some(sql => sql.includes("UPDATE user_sessions SET is_revoked = TRUE")));
  } finally {
    g.isolatedPool = prevPool;
    if (prevTestMode === undefined) delete process.env.SPARTA_TEST_MODE;
    else process.env.SPARTA_TEST_MODE = prevTestMode;
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  }
});
test("evaluateEarthquakeV1MmiWorkflow propagates branch_code and getStoreOwnership keeps UNKNOWN distinct from REGULAR", () => {
  assert.equal(getStoreOwnership(null), "UNKNOWN");
  assert.equal(getStoreOwnership(undefined), "UNKNOWN");
  assert.equal(getStoreOwnership("UNKNOWN"), "UNKNOWN");
  assert.notEqual(getStoreOwnership(null), "REGULER");

  const evaluation = evaluateEarthquakeV1MmiWorkflow({
    earthquake: {
      id: "eq-test-branch-code",
      magnitude: 6.2,
      depthKm: 10,
      latitude: -6.2,
      longitude: 106.5,
      timestamp: now,
    },
    currentTime: now + 11 * 60 * 1000,
    windowStartedAt: now,
    stores: [
      {
        id: "SAT-T100",
        kode_toko: "T100",
        nama_toko: "Toko Uji Gempa",
        cabang: "CIKOKOL",
        branch_code: "KZ01",
        alamat: "",
        latitude: -6.21,
        longitude: 106.51,
        fr_type: "UNKNOWN",
        status: "SAFE",
      },
    ],
  });

  assert.equal(evaluation.allEvaluatedStores.length, 1);
  assert.equal(evaluation.allEvaluatedStores[0].branch_code, "KZ01");
  assert.equal(getStoreOwnership(evaluation.allEvaluatedStores[0].fr_type), "UNKNOWN");
});

test("SSO login identity matching excludes local emergency SYSTEM_ADMIN while keeping SSO users linkable", async () => {
  const localAdminNull = existingUser({
    id: "usr_sysadmin_local",
    external_user_id: null,
    nik: "0001",
    email: "admin.darurat@sat.co.id",
    system_role: "ADMIN",
    business_role: null,
    scope: null,
    branch: null,
    source: "LOCAL",
    sso_status: null,
  });

  assert.equal(isLocalEmergencySystemAdmin(localAdminNull), true);
  assert.equal(isLocalEmergencySystemAdmin({ ...localAdminNull, source: "SPARTA" }), false);

  // Reject LOCAL ADMIN across null, ACTIVE, and PENDING_SSO_GRANT sso_status without running any UPDATE
  for (const ssoStatus of [null, "ACTIVE", "PENDING_SSO_GRANT"] as const) {
    const db = database(sql => sql.startsWith("SELECT * FROM users") ? [{ ...localAdminNull, sso_status: ssoStatus }] : []);
    const res = await matchSsoIdentityToSiagaUser(
      { spartaUserId: "portal-attacker", employeeId: "0001", email: "admin.darurat@sat.co.id", access: ["siaga"] },
      { pool: db.pool }
    );
    assert.equal(res.status, "NOT_FOUND");
    assert.ok(!db.calls.some(call => call.sql.startsWith("UPDATE users")));
  }

  // If both a LOCAL SYSTEM_ADMIN and a SPARTA SSO user share email/NIK, cleanly select the SSO user
  const ssoUser = existingUser({
    id: "usr_sso_op",
    external_user_id: null,
    nik: "0001",
    email: "admin.darurat@sat.co.id",
    system_role: "USER",
    business_role: "bms",
    scope: "BRANCH",
    branch: "CIKOKOL",
    source: "SPARTA",
    sso_status: "ACTIVE",
  });
  const sharedDb = database(sql => {
    if (sql.startsWith("SELECT * FROM users")) return [localAdminNull, ssoUser];
    if (sql.startsWith("UPDATE users SET external_user_id=$2")) return [{ external_user_id: "portal-sso-1" }];
    return [];
  });
  const sharedRes = await matchSsoIdentityToSiagaUser(
    { spartaUserId: "portal-sso-1", employeeId: "0001", email: "admin.darurat@sat.co.id", access: ["siaga"] },
    { pool: sharedDb.pool }
  );
  assert.equal(sharedRes.status, "MATCHED");
  assert.equal(sharedRes.user?.id, "usr_sso_op");
  const updateCall = sharedDb.calls.find(call => call.sql.startsWith("UPDATE users SET external_user_id=$2"))!;
  assert.equal(updateCall.values[0], "usr_sso_op");
  assert.match(updateCall.sql, /NOT \(system_role = 'ADMIN' AND UPPER\(TRIM\(COALESCE\(source, ''\)\)\) = 'LOCAL'\)/);

  // selectSpartaIdentity excludeLocalSystemAdmin drops LOCAL ADMIN but retains SPARTA ADMIN
  const ssoAdmin = { ...localAdminNull, id: "usr_sso_admin", source: "SPARTA", external_user_id: "portal-admin-1" };
  assert.equal(
    selectSpartaIdentity([localAdminNull], { email: "admin.darurat@sat.co.id" }, { excludeLocalSystemAdmin: true }),
    null
  );
  assert.equal(
    selectSpartaIdentity([localAdminNull, ssoAdmin], { spartaUserId: "portal-admin-1", email: "admin.darurat@sat.co.id" }, { excludeLocalSystemAdmin: true })?.id,
    "usr_sso_admin"
  );
});

test("master data sync advisory lock ID is isolated from disaster and store-sync worker locks", async () => {
  assert.equal(MASTER_SYNC_ADVISORY_LOCK_ID, 7421843);
  assert.notEqual(MASTER_SYNC_ADVISORY_LOCK_ID, WORKER_DISASTER_ADVISORY_LOCK_ID);
  assert.notEqual(MASTER_SYNC_ADVISORY_LOCK_ID, WORKER_STORE_SYNC_ADVISORY_LOCK_ID);

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";

  const backfillDb = database(sql => sql.includes(" AS value") ? [{ value: "G001", count: 1 }] : []);
  await backfillPortalBranches({ pool: backfillDb.pool, fetchFn: masterFetch(), apply: true });
  assert.ok(backfillDb.calls.some(call => call.sql.includes(`pg_advisory_xact_lock(${MASTER_SYNC_ADVISORY_LOCK_ID})`)));
  assert.ok(!backfillDb.calls.some(call => call.sql.includes(`pg_advisory_xact_lock(${WORKER_DISASTER_ADVISORY_LOCK_ID})`)));

  const branchSyncDb = database();
  await syncBranchesFromPortal({ pool: branchSyncDb.pool, fetchFn: masterFetch() });
  assert.ok(branchSyncDb.calls.some(call => call.sql.includes(`pg_advisory_xact_lock(${MASTER_SYNC_ADVISORY_LOCK_ID})`)));
  assert.ok(!branchSyncDb.calls.some(call => call.sql.includes(`pg_advisory_xact_lock(${WORKER_DISASTER_ADVISORY_LOCK_ID})`)));

  const storeSyncDb = database(sql => sql.includes("INSERT INTO stores") ? [{ inserted: true }] : []);
  await syncStoresFromPortal({ pool: storeSyncDb.pool, fetchFn: masterFetch(), full: true, confirmFull: true });
  assert.ok(storeSyncDb.calls.some(call => call.sql.includes(`pg_advisory_xact_lock(${MASTER_SYNC_ADVISORY_LOCK_ID})`)));
  assert.ok(!storeSyncDb.calls.some(call => call.sql.includes(`pg_advisory_xact_lock(${WORKER_DISASTER_ADVISORY_LOCK_ID})`)));
});

test("branch backfill inspects and resolves pending_portal_branch before legacy branch fallback", async () => {
  const dryDb = database(sql => {
    if (sql.includes("FROM users") && sql.includes("to_jsonb(users)->'pending_portal_branch'")) {
      return [{ value: "UNMAPPED_PENDING", count: 1 }];
    }
    return [];
  });
  const dryRes = await backfillPortalBranches({ pool: dryDb.pool, fetchFn: masterFetch() });
  assert.equal(dryRes.applied, false);
  assert.equal(dryRes.unmapped.length, 1);
  assert.equal(dryRes.unmapped[0].table, "users");
  assert.equal(dryRes.unmapped[0].value, "UNMAPPED_PENDING");

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const applyDb = database(sql => {
    if (sql.includes("FROM users") && sql.includes("to_jsonb(users)->'pending_portal_branch'")) {
      return [{ value: "KZ01", count: 2 }, { value: "G001", count: 1 }];
    }
    if (sql.includes(" AS value")) return [{ value: "G001", count: 1 }];
    return [];
  });
  const applyRes = await backfillPortalBranches({ pool: applyDb.pool, fetchFn: masterFetch(), apply: true });
  assert.equal(applyRes.applied, true);

  const schemaCheck = applyDb.calls.find(call => call.sql.includes("AS master_schema_ready"))!;
  assert.ok(schemaCheck.sql.includes("('users','pending_portal_branch')"));

  const usersUpdate = applyDb.calls.find(call => call.sql.startsWith("UPDATE users"))!;
  assert.match(usersUpdate.sql, /pending_portal_branch->>'branchCode'/);
  assert.match(usersUpdate.sql, /pending_portal_branch->>'branch'/);
  assert.match(usersUpdate.sql, /branch_code = sparta_resolve_branch/);
  assert.match(usersUpdate.sql, /pending_portal_branch = CASE/);
});
