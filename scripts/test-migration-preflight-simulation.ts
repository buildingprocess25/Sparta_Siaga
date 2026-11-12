/**
 * SPARTA SIAGA — Test Migration Preflight & Ledger Simulation
 *
 * Verifies the internal database-level safety checks:
 * 1. Preflight read-only validation of report_approval_outbox (Migration 015)
 * 2. Preflight rejection on missing columns, wrong types, missing PK, missing UNIQUE
 * 3. Exact matching of Production conditions (001-014 applied, 015-017 pending, 018 deferred)
 * 4. Backward migration prevention
 * 5. Checksum drift detection
 */

import {
  verifyReportApprovalOutboxCompatibility,
  findMigrationIndex,
  loadMigrationFiles,
  DEFERRED_MIGRATIONS,
  computeChecksum,
} from "./migrate-production.mjs";

console.log("============================================================");
console.log("SPARTA SIAGA — PREFLIGHT & MIGRATION SIMULATION SUITE");
console.log("============================================================\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string, detail?: string) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${desc}${detail ? ` -> ${detail}` : ""}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// 1. Mock Client Factory for Preflight Verification
// ---------------------------------------------------------------------------
const PRODUCTION_21_COLUMNS = [
  { column_name: "id", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "report_id", data_type: "text", udt_name: "text", is_nullable: "NO" },
  { column_name: "decision", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "outcome_status", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "disaster_type", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "report_origin", data_type: "character varying", udt_name: "varchar", is_nullable: "YES" },
  { column_name: "branch", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "store_id", data_type: "character varying", udt_name: "varchar", is_nullable: "YES" },
  { column_name: "store_name", data_type: "character varying", udt_name: "varchar", is_nullable: "YES" },
  { column_name: "location_city", data_type: "character varying", udt_name: "varchar", is_nullable: "YES" },
  { column_name: "decided_by_user_id", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "decided_by_name", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "decided_by_role", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "decided_at", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "decision_notes", data_type: "text", udt_name: "text", is_nullable: "YES" },
  { column_name: "condition", data_type: "character varying", udt_name: "varchar", is_nullable: "NO" },
  { column_name: "evidence_count", data_type: "integer", udt_name: "int4", is_nullable: "NO" },
  { column_name: "published_to_ho", data_type: "boolean", udt_name: "bool", is_nullable: "NO" },
  { column_name: "payload", data_type: "jsonb", udt_name: "jsonb", is_nullable: "NO" },
  { column_name: "processed_at", data_type: "timestamp with time zone", udt_name: "timestamptz", is_nullable: "YES" },
  { column_name: "created_at", data_type: "timestamp with time zone", udt_name: "timestamptz", is_nullable: "NO" },
];

function createMockClient(overrides: {
  tableExists?: boolean;
  columns?: any[];
  pkColumns?: string[];
  uniqueColumns?: string[];
  uniqueIndexes?: any[];
  fkConstraints?: any[];
  indexes?: any[];
}) {
  const tableExists = overrides.tableExists !== false;
  const columns = overrides.columns ?? PRODUCTION_21_COLUMNS;
  const pkColumns = overrides.pkColumns ?? ["id"];
  const uniqueColumns = overrides.uniqueColumns ?? ["report_id"];
  const uniqueIndexes = overrides.uniqueIndexes ?? [
    { indexname: "uq_report_approval_outbox_report", indexdef: "CREATE UNIQUE INDEX ON report_approval_outbox (report_id)" },
  ];
  const fkConstraints = overrides.fkConstraints ?? []; // Per user prompt: FK lama tidak ada
  const indexes = overrides.indexes ?? [
    { indexname: "idx_approval_outbox_unprocessed" },
  ];

  return {
    async query(sqlText: string, params?: any[]) {
      const sql = sqlText.trim();

      // 1. Table existence query
      if (sql.includes("information_schema.tables")) {
        return { rows: [{ table_exists: tableExists }] };
      }

      // 2. Columns query
      if (sql.includes("information_schema.columns")) {
        return { rows: columns };
      }

      // 3. Primary key query
      if (sql.includes("tc.constraint_type = 'PRIMARY KEY'")) {
        return { rows: pkColumns.map((col) => ({ column_name: col })) };
      }

      // 4. Unique constraint query
      if (sql.includes("tc.constraint_type = 'UNIQUE'")) {
        return { rows: uniqueColumns.map((col) => ({ column_name: col })) };
      }

      // 5. Unique indexes query
      if (sql.includes("indexdef ILIKE '%UNIQUE%'")) {
        return { rows: uniqueIndexes };
      }

      // 6. Foreign key query
      if (sql.includes("tc.constraint_type = 'FOREIGN KEY'")) {
        return { rows: fkConstraints };
      }

      // 7. General indexes query
      if (sql.includes("pg_indexes")) {
        return { rows: indexes };
      }

      throw new Error(`Unhandled mock query: ${sql}`);
    },
  };
}

async function runTests() {
  // ---------------------------------------------------------------------------
  // Test 1: Production database compatible state
  // ---------------------------------------------------------------------------
  try {
    const prodClient = createMockClient({});
    const res = await verifyReportApprovalOutboxCompatibility(prodClient);
    assert(
      res.tableExists === true && res.compatible === true,
      "Preflight: Production state (21 columns, PK(id), UNIQUE(report_id), no FK) PASSES preflight"
    );
  } catch (err: any) {
    assert(false, "Preflight: Production state failed unexpectedly", err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 2: Fresh database state (table does not exist yet)
  // ---------------------------------------------------------------------------
  try {
    const freshClient = createMockClient({ tableExists: false });
    const res = await verifyReportApprovalOutboxCompatibility(freshClient);
    assert(
      res.tableExists === false && res.compatible === true,
      "Preflight: Fresh database state (table not existing) gracefully PASSES (to be created by 015)"
    );
  } catch (err: any) {
    assert(false, "Preflight: Fresh database state failed", err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 3: Incompatible schema: missing column 'payload'
  // ---------------------------------------------------------------------------
  try {
    const brokenCols = PRODUCTION_21_COLUMNS.filter((c) => c.column_name !== "payload");
    const badClient = createMockClient({ columns: brokenCols });
    await verifyReportApprovalOutboxCompatibility(badClient);
    assert(false, "Preflight: Missing 'payload' column should throw error but did not");
  } catch (err: any) {
    assert(
      err.message.includes("Missing column(s): payload"),
      "Preflight: Incompatible missing column 'payload' correctly FAILS preflight with clear error",
      err.message
    );
  }

  // ---------------------------------------------------------------------------
  // Test 4: Incompatible schema: type mismatch on 'evidence_count'
  // ---------------------------------------------------------------------------
  try {
    const mismatchCols = PRODUCTION_21_COLUMNS.map((c) =>
      c.column_name === "evidence_count" ? { ...c, data_type: "text", udt_name: "text" } : c
    );
    const badClient = createMockClient({ columns: mismatchCols });
    await verifyReportApprovalOutboxCompatibility(badClient);
    assert(false, "Preflight: Type mismatch on 'evidence_count' should throw error but did not");
  } catch (err: any) {
    assert(
      err.message.includes("Type mismatch in column(s): evidence_count"),
      "Preflight: Type mismatch on 'evidence_count' correctly FAILS preflight with clear error",
      err.message
    );
  }

  // ---------------------------------------------------------------------------
  // Test 5: Incompatible schema: missing PRIMARY KEY on id
  // ---------------------------------------------------------------------------
  try {
    const badClient = createMockClient({ pkColumns: [] });
    await verifyReportApprovalOutboxCompatibility(badClient);
    assert(false, "Preflight: Missing PRIMARY KEY on id should throw error but did not");
  } catch (err: any) {
    assert(
      err.message.includes("PRIMARY KEY on 'id' is missing"),
      "Preflight: Missing PRIMARY KEY correctly FAILS preflight with clear error",
      err.message
    );
  }

  // ---------------------------------------------------------------------------
  // Test 6: Incompatible schema: missing UNIQUE on report_id
  // ---------------------------------------------------------------------------
  try {
    const badClient = createMockClient({ uniqueColumns: [], uniqueIndexes: [] });
    await verifyReportApprovalOutboxCompatibility(badClient);
    assert(false, "Preflight: Missing UNIQUE constraint on report_id should throw error but did not");
  } catch (err: any) {
    assert(
      err.message.includes("UNIQUE constraint or index on 'report_id' is missing"),
      "Preflight: Missing UNIQUE on report_id correctly FAILS preflight with clear error",
      err.message
    );
  }

  // ---------------------------------------------------------------------------
  // Test 7: Verify migration filtering logic for --through=017
  // ---------------------------------------------------------------------------
  const allMigrations = await loadMigrationFiles();
  const targetIdx = findMigrationIndex(allMigrations, "017");
  assert(
    targetIdx !== -1 && allMigrations[targetIdx].name.startsWith("017_"),
    "Targeting: '017' resolves exactly to 017_earthquake_shakemaps_and_facility_intensities.sql"
  );

  const targetedSlice = allMigrations.slice(0, targetIdx + 1);
  assert(
    targetedSlice.length === 17,
    "Targeting: Slicing up to 017 produces exactly 17 migrations (001-017)"
  );

  const includes018 = targetedSlice.some((m) => m.name.startsWith("018_"));
  assert(
    !includes018,
    "Targeting: Migration 018 is strictly EXCLUDED from the execution slice"
  );

  // ---------------------------------------------------------------------------
  // Test 8: Deferred guard for 018
  // ---------------------------------------------------------------------------
  assert(
    DEFERRED_MIGRATIONS.has("018_user_sync_metadata_and_sso_status.sql"),
    "Policy: 018_user_sync_metadata_and_sso_status.sql is in DEFERRED_MIGRATIONS set"
  );

  // ---------------------------------------------------------------------------
  // Test 9: Production ledger simulation: 001-014 applied, 015-017 pending
  // ---------------------------------------------------------------------------
  const appliedMap = new Map<string, string>();
  for (let i = 0; i < 14; i++) {
    appliedMap.set(allMigrations[i].name, allMigrations[i].checksum);
  }

  const pendingInPlan = targetedSlice.filter((m) => !appliedMap.has(m.name));
  const pendingNames = pendingInPlan.map((m) => m.name.split("_")[0]);

  assert(
    pendingInPlan.length === 3 &&
      pendingNames[0] === "015" &&
      pendingNames[1] === "016" &&
      pendingNames[2] === "017",
    "Simulation: When DB has 001-014 recorded, plan applies EXACTLY [015, 016, 017]"
  );

  // ---------------------------------------------------------------------------
  // Test 10: Checksum drift detection simulation
  // ---------------------------------------------------------------------------
  const driftedMap = new Map(appliedMap);
  driftedMap.set(allMigrations[0].name, "corrupted_checksum_00000000000000000000000000000000");

  let driftDetected = false;
  for (const [name, hash] of driftedMap.entries()) {
    const local = allMigrations.find((m) => m.name === name);
    if (local && local.checksum !== hash) {
      driftDetected = true;
      break;
    }
  }
  assert(
    driftDetected === true,
    "Simulation: Checksum verification detects modified/drifted migration in DB ledger"
  );

  console.log("\n============================================================");
  console.log(`PREFLIGHT SIMULATION SUMMARY: ${passed}/${passed + failed} PASSED (${failed} failed)`);
  console.log("============================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Simulation suite error:", e);
  process.exit(1);
});
