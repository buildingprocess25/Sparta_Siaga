import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test, { beforeEach } from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  compareFacilityMasters,
  projectSiagaFacilityForComparison,
} from "../lib/sparta-facility-comparison";
import { applyFacilityImport } from "../lib/facility-db";
import { updateFacilityAdmin } from "../lib/facility-service";
import type { PortalBranch } from "../lib/sparta-master-contract";
import { clearBranchKeyCache } from "../lib/sparta-master-sync";

const portalBranches: PortalBranch[] = [
  {
    code: "KZ01",
    name: "CIKOKOL",
    aliases: ["G001", "CABANG CIKOKOL"],
    isActive: true,
    updatedAt: "2026-11-24T00:00:00.000Z",
  },
  {
    code: "JZ01",
    name: "CILEUNGSI 2",
    aliases: ["CILEUNGSI", "CILEUNGSI_2"],
    isActive: true,
    updatedAt: "2026-11-24T00:00:00.000Z",
  },
];

beforeEach(() => {
  delete process.env.SPARTA_BRANCH_MASTER_ENABLED;
  clearBranchKeyCache();
});

test("compareFacilityMasters resolves legacy aliases via portal branches, tolerates micro rounding, and reports discrepancies", () => {
  const siaga = [
    projectSiagaFacilityForComparison({
      code: "dc01",
      name: "  Warehouse Cikokol  ",
      facility_type: "STORE HUB",
      latitude: -6.200001,
      longitude: 106.500001,
      branch_id: "G001",
    }),
    projectSiagaFacilityForComparison({
      code: "DC02",
      name: "Depo Lama",
      facility_type: "DEPO",
      latitude: -6.3,
      longitude: 106.6,
      branch_id: "UNMAPPED_BRANCH",
    }),
    projectSiagaFacilityForComparison({
      code: "DC03",
      name: "Gudang Hanya Siaga",
      facility_type: "WAREHOUSE",
      latitude: null,
      longitude: 106.7,
      branch_id: "CIKOKOL",
    }),
  ];

  const carbontrack = [
    {
      code: "DC01",
      name: "WAREHOUSE CIKOKOL",
      type: "STORE_HUB",
      latitude: -6.2,
      longitude: 106.5,
      branchCode: "KZ01",
    },
    {
      code: "DC02",
      name: "Depo Resmi",
      type: "BULKY",
      latitude: -6.35,
      longitude: 106.6,
      branchCode: "JZ01",
    },
    {
      code: "DC04",
      name: "Hub Hanya CarbonTrack",
      type: "DC",
      latitude: -6.4,
      longitude: null,
      branchCode: "KZ01",
    },
  ];

  const result = compareFacilityMasters(siaga, carbontrack, { portalBranches });

  assert.equal(result.siagaCount, 3);
  assert.equal(result.carbontrackCount, 3);
  assert.equal(result.matchedExactCount, 1);
  assert.equal(result.differentCount, 1);
  assert.deepEqual(result.onlySiaga, ["DC03"]);
  assert.deepEqual(result.onlyCarbontrack, ["DC04"]);
  assert.equal(result.portalBranchResolutionUsed, true);
  assert.deepEqual(result.different[0].code, "DC02");
  assert.deepEqual(result.different[0].fields, ["name", "type", "latitude", "branchCode"]);
  assert.deepEqual(result.different[0].details.branchCode, { siaga: "UNMAPPED_BRANCH", carbontrack: "JZ01" });
  assert.deepEqual(result.missingCoordinates, { siaga: ["DC03"], carbontrack: ["DC04"] });
  assert.deepEqual(result.unmappedBranches, {
    siaga: [{ code: "DC02", rawBranch: "UNMAPPED_BRANCH", reason: "unmapped" }],
    carbontrack: [],
  });
  assert.equal(result.sourceDecision, "PENDING_AGREEMENT");
  assert.equal(result.portalSync, "BLOCKED_NO_PORTAL_FACILITY_CONTRACT");
});

test("applyFacilityImport preserves operational SIAGA fields (auto_report_enabled, branch_id, mapping verification) on upsert", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fakeClient = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT current_database()")) {
        return { rows: [{ database_name: "sparta_siaga_isolated" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO facility_import_runs")) {
        return { rows: [{ id: "run-1" }], rowCount: 1 };
      }
      if (sql.includes("FROM facilities")) {
        return {
          rows: [{
            id: "fac-1",
            code: "DC01",
            name: "Nama Lama",
            initials: "NL",
            facility_type: "DC",
            latitude: -6.1,
            longitude: 106.4,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO facilities")) {
        return { rows: [{ id: "fac-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  } as unknown as PoolClient;

  const prevEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  try {
    const runId = await applyFacilityImport(
      fakeClient,
      {
        sourceName: "KOORDINAT GUDANG.xlsx",
        total: 1,
        newCount: 0,
        changedCount: 1,
        unchangedCount: 0,
        invalidCount: 0,
        invalid: [],
        records: [
          {
            sourceRow: 2,
            code: "DC01",
            name: "Nama Baru",
            initials: "NB",
            type: "WAREHOUSE",
            latitude: -6.2,
            longitude: 106.5,
          },
        ],
      },
      "usr_admin"
    );
    assert.equal(runId, "run-1");
  } finally {
    if (prevEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  }

  const upsertSql = calls.find((c) => c.sql.includes("INSERT INTO facilities"))!.sql;
  const doUpdateClause = upsertSql.slice(upsertSql.indexOf("DO UPDATE SET"));
  assert.ok(!/branch_id|mapping_verified|operational_status|auto_report_enabled/.test(doUpdateClause));
  assert.ok(calls.some((c) => c.sql.includes("INSERT INTO facility_audit_logs")));
});

test("updateFacilityAdmin normalizes branchId to active Portal branch code when branch master is enabled", async () => {
  process.env.SPARTA_BRANCH_MASTER_ENABLED = "true";
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fakeClient = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT * FROM facilities WHERE id = $1 FOR UPDATE")) {
        return {
          rows: [{
            id: "fac-1",
            branch_id: null,
            mapping_verified_at: null,
            auto_report_enabled: false,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM sparta_master_branches WHERE is_active = TRUE")) {
        return { rows: portalBranches, rowCount: portalBranches.length };
      }
      if (sql.includes("UPDATE facilities SET")) {
        return { rows: [{ id: "fac-1", branch_id: values[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const pool = { query: fakeClient.query, connect: async () => fakeClient } as unknown as Pool;

  const updated = await updateFacilityAdmin(
    { id: "fac-1", branchId: "G001", actorUserId: "usr_admin" },
    { pool }
  );
  assert.equal(updated.branch_id, "KZ01");

  await assert.rejects(
    updateFacilityAdmin(
      { id: "fac-1", branchId: "CABANG_TIDAK_DIKENAL", actorUserId: "usr_admin" },
      { pool }
    ),
    /UNKNOWN_PORTAL_BRANCH/
  );
});

test("facility comparison CLI fails before opening database when --carbontrack file is missing", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/sparta-facility-compare.ts",
          "--carbontrack=scratch/nonexistent-carbontrack-facilities.json",
        ],
        { encoding: "utf8", stdio: "pipe" }
      ),
    (error: unknown) => {
      const stderr = String((error as { stderr?: unknown }).stderr);
      return stderr.includes("ENOENT") || stderr.includes("no such file");
    }
  );
});
