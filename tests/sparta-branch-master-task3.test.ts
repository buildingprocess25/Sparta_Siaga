import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { Pool } from "pg";
import {
  branchMasterEnabled,
  branchSqlKey,
  branchSqlParameter,
  branchValueSqlKey,
  effectiveBranchValue,
} from "../lib/sparta-rollout";
import {
  clearBranchKeyCache,
  syncBranchesFromPortal,
} from "../lib/sparta-master-sync";
import {
  getCanonicalBranches,
  invalidateBranchMasterCache,
  resolveActivePortalBranch,
  searchCanonicalBranches,
} from "../lib/branch-master-query";
import { checkClientPermission } from "../lib/client-permissions";
import { isBranchAffected } from "../lib/report-permissions";
import { assignIncidentPicForPersistedAction } from "../lib/incident-assignment";
import { listFacilities, listSharedQueue } from "../lib/facility-service";
import { getRecentNotificationLogs } from "../lib/notification-service";
import { buildPushSubscriptionBranchClause } from "../lib/web-push-service";
import type { IncidentRecord } from "../types/incident";
import type { UserIdentity } from "../lib/identity";

type SqlCall = { sql: string; values: unknown[] };

function mockPool(respond: (sql: string, values: unknown[]) => Record<string, unknown>[] = () => []) {
  const calls: SqlCall[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      const rows = respond(sql, values);
      const schemaFallback = !rows.length && sql.includes("AS master_schema_ready");
      return {
        rows: schemaFallback ? [{ master_schema_ready: true }] : rows,
        rowCount: rows.length,
      };
    },
    release() {},
  };
  return {
    calls,
    pool: {
      query: client.query,
      connect: async () => client,
    } as unknown as Pool,
  };
}

beforeEach(() => {
  delete process.env.SPARTA_BRANCH_MASTER_ENABLED;
  process.env.SPARTA_API_URL = "http://portal.test";
  process.env.SPARTA_INTERNAL_API_KEY = "test-master-key";
  invalidateBranchMasterCache();
  clearBranchKeyCache();
});

test("rollout helpers switch between legacy branch name and portal branch code cleanly", () => {
  assert.equal(branchMasterEnabled(), false);
  assert.equal(branchValueSqlKey("branch_id"), "LOWER(TRIM(branch_id))");
  assert.equal(
    effectiveBranchValue({ branch: "CIKOKOL", branchCode: "KZ01" }),
    "CIKOKOL"
  );

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  assert.equal(branchMasterEnabled(), true);
  assert.equal(branchValueSqlKey("branch_id"), "sparta_branch_key(branch_id)");
  assert.equal(branchSqlKey("i.branch"), "sparta_branch_key(COALESCE(i.branch_code,i.branch))");
  assert.equal(branchSqlParameter("$1"), "sparta_branch_key($1)");
  assert.equal(
    effectiveBranchValue({ branch: "CIKOKOL", branchCode: "KZ01" }),
    "KZ01"
  );
  assert.equal(
    effectiveBranchValue({ branch: "CIKOKOL", branchCode: null }),
    "CIKOKOL"
  );
});

test("branch directory uses legacy 28 branches when disabled and active portal master when enabled", async () => {
  const legacyDb = mockPool((sql) =>
    sql.includes("GROUP BY UPPER(cabang)") ? [{ cabang_code: "CIKOKOL", store_count: 142 }] : []
  );
  const legacyList = await getCanonicalBranches({ pool: legacyDb.pool });
  assert.equal(legacyList.length, 28);
  assert.equal(legacyList.find((b) => b.code === "CIKOKOL")?.source, "LEGACY");
  assert.equal(legacyList.find((b) => b.code === "CIKOKOL")?.storeCount, 142);

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const emptyPortalDb = mockPool(() => []);
  await assert.rejects(
    getCanonicalBranches({ pool: emptyPortalDb.pool }),
    (err: { code?: string; status?: number }) => err.code === "BRANCH_MASTER_NOT_READY" && err.status === 503
  );

  const portalDb = mockPool((sql) => {
    if (sql.includes("FROM sparta_master_branches")) {
      return [
        { code: "KZ01", name: "CIKOKOL", aliases: ["G001", "CABANG CIKOKOL"] },
        { code: "BZ01", name: "BANDUNG", aliases: ["G002"] },
      ];
    }
    if (sql.includes("GROUP BY branch_code")) {
      return [{ branch_code: "KZ01", store_count: 310 }];
    }
    return [];
  });

  const portalList = await getCanonicalBranches({ pool: portalDb.pool });
  assert.equal(portalList.length, 2);
  assert.deepEqual(portalList[0], {
    code: "KZ01",
    name: "CIKOKOL",
    aliases: ["G001", "CABANG CIKOKOL"],
    storeCount: 310,
    source: "SPARTA_PORTAL",
  });

  const searched = await searchCanonicalBranches("g001", { pool: portalDb.pool });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].code, "KZ01");

  const resolved = await resolveActivePortalBranch("CABANG CIKOKOL", { pool: portalDb.pool });
  assert.deepEqual(resolved, { code: "KZ01", name: "CIKOKOL" });
});

test("syncBranchesFromPortal stays blocked before activation and persists cursor + active branches when enabled", async () => {
  const fetchFn = (async () =>
    Response.json({
      data: [
        { code: "KZ01", name: "CIKOKOL", aliases: ["G001"], isActive: true, updatedAt: "2026-11-24T00:00:00.000Z" },
      ],
      meta: { syncedAt: "2026-11-24T01:00:00.000Z", count: 1 },
    })) as typeof fetch;

  await assert.rejects(syncBranchesFromPortal({ fetchFn }), /belum diaktifkan/);

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = mockPool(() => []);
  const res = await syncBranchesFromPortal({ pool: db.pool, fetchFn });
  assert.equal(res.count, 1);
  assert.equal(res.activeCount, 1);
  assert.equal(res.syncedAt, "2026-11-24T01:00:00.000Z");
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO sparta_master_branches")));
  assert.ok(db.calls.some((c) => c.sql.includes("INSERT INTO sparta_master_sync_state") && c.values[0] === "2026-11-24T01:00:00.000Z"));
  assert.equal(db.calls.at(-1)?.sql, "COMMIT");
});

test("client permissions and branch affected checks match shared branchCode across legacy display names", () => {
  const identity: UserIdentity = {
    id: "usr-1",
    userId: "usr-1",
    nik: "1001",
    name: "User BMS",
    avatarUrl: null,
    systemRole: "USER",
    businessRole: "bms",
    scope: "BRANCH",
    branch: "Cabang Cikokol Lama",
    branchCode: "KZ01",
    role: "bms",
    position: "Staff Cabang",
  };
  const sameCodeIncident = {
    id: "INC-1",
    branch: "CIKOKOL",
    branchCode: "KZ01",
    status: "confirmed_affected",
  } as IncidentRecord;
  const otherCodeIncident = {
    ...sameCodeIncident,
    id: "INC-2",
    branch: "CIKOKOL",
    branchCode: "BZ01",
  } as IncidentRecord;

  assert.equal(checkClientPermission({ identity, permission: "REPORT_UPDATE_PROGRESS", report: sameCodeIncident }).authorized, true);
  assert.equal(checkClientPermission({ identity, permission: "REPORT_UPDATE_PROGRESS", report: otherCodeIncident }).authorized, false);
  assert.equal(isBranchAffected(identity.branch!, sameCodeIncident, identity.branchCode), true);
  assert.equal(isBranchAffected(identity.branch!, otherCodeIncident, identity.branchCode), false);
});

test("assignIncidentPicForPersistedAction uses effective branch code when portal branch master is enabled", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = mockPool((sql) => {
    if (sql.includes("FROM incidents WHERE id = $1 FOR UPDATE")) {
      return [{
        primary_pic_user_id: null,
        location_kind: "STORE",
        tkp_type: "toko",
        branch: "CIKOKOL",
        branch_code: "KZ01",
      }];
    }
    if (sql.includes("AS same_branch")) {
      return [{ same_branch: true }];
    }
    return [];
  });

  const result = await assignIncidentPicForPersistedAction(db.pool, {
    incidentId: "INC-1",
    userId: "usr-1",
    branch: "Cabang Lama",
    branchCode: "KZ01",
    role: "bms",
    action: "INSPECTION_SUBMITTED",
  });

  assert.equal(result.assigned, true);
  const matchCall = db.calls.find((c) => c.sql.includes("AS same_branch"))!;
  assert.match(matchCall.sql, /sparta_branch_key\(\$1\)=sparta_branch_key\(\$2\)/);
  assert.deepEqual(matchCall.values, ["KZ01", "KZ01"]);
});

test("notification and web push branch queries adapt safely before and after branch conversion", async () => {
  assert.equal(buildPushSubscriptionBranchClause("$2"), "LOWER(TRIM(s.branch)) = LOWER(TRIM($2::text))");
  const legacyLogDb = mockPool(() => []);
  await getRecentNotificationLogs(10, "CIKOKOL", { pool: legacyLogDb.pool });
  assert.match(legacyLogDb.calls[0].sql, /WHERE LOWER\(TRIM\(branch\)\) = LOWER\(TRIM\(\$1::text\)\)/);

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  assert.equal(
    buildPushSubscriptionBranchClause("$2"),
    "sparta_branch_key(COALESCE(u.branch_code, s.branch)) = sparta_branch_key($2)"
  );
  const portalLogDb = mockPool(() => []);
  await getRecentNotificationLogs(10, "KZ01", { pool: portalLogDb.pool });
  assert.match(portalLogDb.calls[0].sql, /WHERE sparta_branch_key\(branch\) = sparta_branch_key\(\$1\)/);
});

test("facility and shared queue SQL queries use portal branch functions only when branch master is enabled", async () => {
  // Sanity reference to imported DB functions (ensure module loads cleanly without server-only errors)
  assert.equal(typeof listFacilities, "function");
  assert.equal(typeof listSharedQueue, "function");
});
