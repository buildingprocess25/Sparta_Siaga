import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import type { Pool } from "pg";
import { syncMasterStores } from "../lib/store-sync";
import { syncStoresFromPortal, clearBranchKeyCache } from "../lib/sparta-master-sync";
import { getLastStoreSyncHistory } from "../lib/google-sheets-sync";
import {
  isStoreSyncDue,
  runAutonomousStoreSyncCycle,
  WORKER_STORE_SYNC_ADVISORY_LOCK_ID,
} from "../lib/server-daemon";
import { getOrLoadMasterStores, getBranchCentroidsFromStores, invalidateMasterStoresCache } from "../lib/store-master-loader";

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
  delete process.env.STORE_MASTER_SOURCE;
  process.env.SPARTA_API_URL = "http://portal.test";
  process.env.SPARTA_INTERNAL_API_KEY = "test-master-key";
  invalidateMasterStoresCache();
  clearBranchKeyCache();
});

test("syncMasterStores rejects portal source when branch conversion flag is still disabled", () => {
  process.env.STORE_MASTER_SOURCE = "portal";
  assert.throws(() => syncMasterStores(), (err: { code?: string }) => err.code === "MASTER_CONVERSION_DISABLED");
});

test("syncStoresFromPortal normalizes empty address to null, updates branches + stores cursors, and deactivates removed stores without DELETE", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const db = mockPool((sql, values) => {
    if (sql.includes("INSERT INTO stores")) {
      const batch = JSON.parse(String(values[0])) as Array<{ code: string }>;
      return batch.map((_, idx) => ({ inserted: idx === 0 }));
    }
    return [];
  });

  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/v1/master/branches")) {
      return Response.json({
        data: [
          { code: "KZ01", name: "CIKOKOL", aliases: ["G001"], isActive: true, updatedAt: "2026-11-24T01:00:00.000Z" },
        ],
        meta: { syncedAt: "2026-11-24T01:00:00.000Z", count: 1 },
      });
    }
    return Response.json({
      data: [
        {
          code: "T001",
          name: "Toko Satu",
          branchCode: "KZ01",
          address: "   ",
          latitude: -6.2,
          longitude: 106.5,
          ownershipType: null,
          isActive: true,
          updatedAt: "2026-11-24T02:00:00.000Z",
        },
        {
          code: "T002",
          name: "Toko Dua",
          branchCode: "KZ01",
          address: "Jl. Portal Resmi No. 2",
          latitude: null,
          longitude: null,
          ownershipType: "FRANCHISE",
          isActive: false,
          updatedAt: "2026-11-24T02:00:00.000Z",
        },
      ],
      meta: { syncedAt: "2026-11-24T02:00:00.000Z", count: 2 },
    });
  }) as typeof fetch;

  const result = await syncStoresFromPortal({ pool: db.pool, fetchFn, confirmFull: true });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.records_read, 2);
  assert.equal(result.records_added, 1);
  assert.equal(result.records_updated, 1);

  const upsertCall = db.calls.find((c) => c.sql.includes("INSERT INTO stores"))!;
  const batch = JSON.parse(String(upsertCall.values[0])) as Array<Record<string, unknown>>;
  assert.equal(batch[0].address, null);
  assert.equal(batch[0].ownership_type, "UNKNOWN");
  assert.equal(batch[1].address, "Jl. Portal Resmi No. 2");
  assert.equal(batch[1].is_active, false);

  assert.ok(db.calls.some((c) => c.sql.includes("UPDATE stores SET is_active=FALSE")));
  assert.ok(!db.calls.some((c) => c.sql.includes("DELETE FROM stores")));
  assert.ok(db.calls.some((c) => c.sql.includes("VALUES('branches',$1)") && c.values[0] === "2026-11-24T01:00:00.000Z"));
  assert.ok(db.calls.some((c) => c.sql.includes("VALUES('stores',$1)") && c.values[0] === "2026-11-24T02:00:00.000Z"));
});

test("getLastStoreSyncHistory is read-only without DDL, tolerates absent table, and filters by source + COMPLETED status", async () => {
  const missingTablePool = {
    async query() {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    },
  } as unknown as Pool;
  assert.equal(await getLastStoreSyncHistory({ pool: missingTablePool }), null);

  const db = mockPool(() => [
    {
      id: "sync-1",
      sync_source: "SPARTA_PORTAL",
      status: "COMPLETED",
      started_at: "2026-11-24T01:00:00.000Z",
      completed_at: "2026-11-24T01:05:00.000Z",
      records_read: 100,
      records_added: 5,
      records_updated: 95,
      records_skipped: 0,
      records_failed: 0,
      error_message: null,
    },
  ]);

  const record = await getLastStoreSyncHistory({
    onlyCompleted: true,
    source: "SPARTA_PORTAL",
    pool: db.pool,
  });

  assert.equal(record?.sourceType, "SPARTA_PORTAL");
  assert.equal(record?.sourceLabel, "Portal SPARTA");
  assert.ok(!db.calls.some((c) => /CREATE TABLE|ALTER TABLE/i.test(c.sql)));
  assert.match(db.calls[0].sql, /WHERE status = 'COMPLETED' AND sync_source = 'SPARTA_PORTAL'/);
});

test("autonomous store sync scheduler honors conversion lock, source-specific due check, and advisory lock exclusion", async () => {
  process.env.STORE_MASTER_SOURCE = "portal";
  assert.equal(await isStoreSyncDue(), false);
  const blocked = await runAutonomousStoreSyncCycle(true);
  assert.equal(blocked.success, false);
  assert.equal(blocked.status, "CONVERSION_DISABLED");

  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const recentPortalDb = mockPool(() => [
    {
      id: "sync-portal-recent",
      sync_source: "SPARTA_PORTAL",
      status: "COMPLETED",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      records_read: 10,
      records_added: 1,
      records_updated: 9,
      records_skipped: 0,
      records_failed: 0,
      error_message: null,
    },
  ]);
  assert.equal(await isStoreSyncDue({ pool: recentPortalDb.pool }), false);

  const notDueCycle = await runAutonomousStoreSyncCycle(false, { pool: recentPortalDb.pool });
  assert.equal(notDueCycle.success, true);
  assert.equal(notDueCycle.status, "NOT_DUE");

  const lockBusyDb = mockPool((sql) => {
    if (sql.includes("pg_try_advisory_lock")) return [{ acquired: false }];
    return [];
  });
  const lockBusyResult = await runAutonomousStoreSyncCycle(true, { pool: lockBusyDb.pool });
  assert.equal(lockBusyResult.success, false);
  assert.equal(lockBusyResult.status, "ALREADY_RUNNING");
  assert.equal(
    lockBusyDb.calls.find((c) => c.sql.includes("pg_try_advisory_lock"))?.values[0],
    WORKER_STORE_SYNC_ADVISORY_LOCK_ID
  );

  // When advisory lock succeeds, autonomous cycle syncs Portal incrementally when cursor exists
  const portalAutoDb = mockPool((sql, values) => {
    if (sql.includes("pg_try_advisory_lock")) return [{ acquired: true }];
    if (sql.includes("FROM store_sync_history")) return [];
    if (sql.includes("SELECT synced_at FROM sparta_master_sync_state WHERE resource='stores'")) {
      return [{ synced_at: "2026-11-24T00:00:00.000Z" }];
    }
    if (sql.includes("INSERT INTO stores")) {
      const batch = JSON.parse(String(values[0])) as Array<{ code: string }>;
      return batch.map(() => ({ inserted: false }));
    }
    return [];
  });
  const autoFetch = (async (input: string | URL | Request) => {
    if (String(input).includes("/branches")) {
      return Response.json({
        data: [{ code: "KZ01", name: "CIKOKOL", aliases: [], isActive: true, updatedAt: "2026-11-24T01:00:00.000Z" }],
        meta: { syncedAt: "2026-11-24T01:00:00.000Z", count: 1 },
      });
    }
    return Response.json({
      data: [{
        code: "T001", name: "Toko Portal", branchCode: "KZ01", address: "Jl. Test",
        latitude: -6.2, longitude: 106.5, ownershipType: "REGULAR", isActive: true, updatedAt: "2026-11-24T02:00:00.000Z",
      }],
      meta: { syncedAt: "2026-11-24T02:00:00.000Z", count: 1 },
    });
  }) as typeof fetch;

  const ran = await runAutonomousStoreSyncCycle(false, { pool: portalAutoDb.pool, fetchFn: autoFetch });
  assert.equal(ran.success, true);
  assert.equal(ran.status, "COMPLETED");
  assert.equal(ran.record?.sourceType, "SPARTA_PORTAL");
  assert.ok(portalAutoDb.calls.some((c) => c.sql.includes("pg_advisory_unlock")));
});

test("getOrLoadMasterStores enforces portal active filter and preserves UNKNOWN ownership", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  process.env.STORE_MASTER_SOURCE = "portal";

  const db = mockPool(() => [
    {
      id: "SAT-T001",
      kode_toko: "T001",
      nama_toko: "Toko Portal",
      cabang: "CIKOKOL",
      branch_code: "KZ01",
      alamat: "",
      latitude: -6.2,
      longitude: 106.5,
      fr_type: null,
      branch_emergency_contact: null,
    },
  ]);

  const stores = await getOrLoadMasterStores(true, { pool: db.pool });
  assert.match(db.calls[0].sql, /AND is_active=TRUE AND master_source='SPARTA_PORTAL'/);
  assert.equal(stores.length, 1);
  assert.equal(stores[0].branch_code, "KZ01");
  assert.equal(stores[0].fr_type, "UNKNOWN");
  assert.equal(stores[0].alamat, "");

  // When Portal store has alamat: null, return empty string (never synthetic fallback) and group centroids by branch_code
  const nullAddrDb = mockPool(() => [
    {
      id: "SAT-T002",
      kode_toko: "T002",
      nama_toko: "Toko Dua",
      cabang: "CIKOKOL",
      branch_code: "KZ01",
      alamat: null,
      latitude: -6.2,
      longitude: 106.5,
      fr_type: "FRANCHISE",
      branch_emergency_contact: null,
    },
    {
      id: "SAT-T003",
      kode_toko: "T003",
      nama_toko: "Toko Tiga",
      cabang: "BALARAJA",
      branch_code: "KZ01",
      alamat: "Jl. Resmi",
      latitude: -6.3,
      longitude: 106.4,
      fr_type: "REGULAR",
      branch_emergency_contact: null,
    },
  ]);
  const loaded = await getOrLoadMasterStores(true, { pool: nullAddrDb.pool });
  assert.equal(loaded[0].alamat, "");
  assert.equal(loaded[1].alamat, "Jl. Resmi");

  const centroids = getBranchCentroidsFromStores(loaded);
  assert.equal(centroids.length, 1);
  assert.equal(centroids[0].branch_code, "KZ01");
  assert.equal(centroids[0].store_count, 2);
});

test("getOrLoadMasterStores loads over 25000 stores without hard LIMIT truncation", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  process.env.STORE_MASTER_SOURCE = "portal";

  const rows = Array.from({ length: 25005 }, (_, i) => ({
    id: `SAT-T${i}`,
    kode_toko: `T${String(i).padStart(5, "0")}`,
    nama_toko: `Toko ${i}`,
    cabang: "CIKOKOL",
    branch_code: "KZ01",
    alamat: null,
    latitude: -6.2,
    longitude: 106.5,
    fr_type: "REGULAR",
    branch_emergency_contact: null,
  }));
  const db = mockPool(() => rows);

  const loaded = await getOrLoadMasterStores(true, { pool: db.pool });
  assert.equal(loaded.length, 25005);
  assert.ok(!/\bLIMIT\b/i.test(db.calls[0].sql));
  assert.match(db.calls[0].sql, /ORDER BY kode_toko ASC/);
});
