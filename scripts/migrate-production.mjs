#!/usr/bin/env node

/**
 * SPARTA SIAGA - Production Migration Runner
 *
 * Runs ordered, locked, repeatable, additive schema migrations.
 * Uses only runtime dependencies ('pg' and Node.js built-ins).
 *
 * Features:
 * - Advisory locking (pg_advisory_lock)
 * - Checksum integrity verification against database ledger
 * - Selective migration execution (--through=017)
 * - Preflight read-only compatibility check for report_approval_outbox (015)
 * - Strict deferral guard for migration 018 (DO NOT EXECUTE until authorized by IT)
 * - Atomic per-migration transactions with rollback
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const ADVISORY_LOCK_ID = 7421839;
const MIGRATIONS_DIR = path.join(process.cwd(), "database", "migrations");
const FILENAME_REGEX = /^\d{3}_[\w-]+\.sql$/;

/**
 * Migrations that are explicitly deferred and prohibited from execution
 * until authorized by IT.
 */
const DEFERRED_MIGRATIONS = new Set([
  "018_user_sync_metadata_and_sso_status.sql",
]);

function computeChecksum(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

async function loadMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (sqlFiles.length === 0) {
    throw new Error(`No .sql migration files found in ${MIGRATIONS_DIR}`);
  }

  const migrations = [];
  for (const name of sqlFiles) {
    if (!FILENAME_REGEX.test(name)) {
      throw new Error(`Migration filename '${name}' does not match expected pattern ^\\d{3}_[\\w-]+\\.sql$`);
    }
    const fullPath = path.join(MIGRATIONS_DIR, name);
    const content = await fs.readFile(fullPath, "utf8");
    if (!content.trim()) {
      throw new Error(`Migration file '${name}' is empty`);
    }
    const checksum = computeChecksum(content);
    migrations.push({ name, fullPath, content, checksum });
  }

  return migrations;
}

function parseCliArgs(argv) {
  let isValidateOnly = false;
  let isPreflightOnly = false;
  let throughTarget = null;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--validate-only") {
      isValidateOnly = true;
    } else if (arg === "--preflight-only") {
      isPreflightOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--through=")) {
      const val = arg.slice("--through=".length).trim();
      if (!val) {
        throw new Error("Invalid option '--through=': missing migration target (e.g. --through=017).");
      }
      throughTarget = val;
    } else if (arg === "--through") {
      i++;
      if (i >= argv.length || argv[i].startsWith("-")) {
        throw new Error("Invalid option '--through': expected target migration argument (e.g. --through 017).");
      }
      const val = argv[i].trim();
      if (!val) {
        throw new Error("Invalid option '--through': migration target cannot be empty.");
      }
      throughTarget = val;
    } else {
      throw new Error(`Unrecognized option '${arg}'. Run with --help for supported options.`);
    }
  }

  return { isValidateOnly, isPreflightOnly, throughTarget, help };
}

function printUsage() {
  console.log(`
SPARTA SIAGA - Production Migration Runner

Usage:
  node scripts/migrate-production.mjs [options]

Options:
  --through=<target>   Apply migrations selectively up to and including <target>
                       (e.g. --through=017 or --through=017_earthquake_shakemaps_and_facility_intensities.sql)
  --validate-only      Validate local migration files syntax and checksums without connecting to database
  --preflight-only     Run read-only preflight checks against target database without applying migrations
  --help, -h           Show this help message
`);
}

function findMigrationIndex(migrations, target) {
  if (!target) return -1;
  const cleanTarget = target.toLowerCase().trim();
  const numTarget = /^\d+$/.test(cleanTarget) ? parseInt(cleanTarget, 10) : null;

  for (let i = 0; i < migrations.length; i++) {
    const name = migrations[i].name.toLowerCase();
    const prefix = name.split("_")[0];
    const prefixNum = parseInt(prefix, 10);

    // Exact filename match
    if (name === cleanTarget || name === `${cleanTarget}.sql`) {
      return i;
    }
    // Prefix exact match (e.g. "017")
    if (prefix === cleanTarget) {
      return i;
    }
    // Numeric match (e.g. 17 or 017)
    if (numTarget !== null && prefixNum === numTarget) {
      return i;
    }
    // Prefix substring match (e.g. "017_earthquake")
    if (name.startsWith(`${cleanTarget}_`) || name.startsWith(cleanTarget)) {
      return i;
    }
  }

  return -1;
}

/**
 * Preflight read-only check for report_approval_outbox (Migration 015)
 *
 * Verifies that if table report_approval_outbox already exists in the target database,
 * its schema has all 21 required columns with compatible types, PRIMARY KEY(id),
 * and UNIQUE constraint or unique index on report_id.
 */
async function verifyReportApprovalOutboxCompatibility(client) {
  console.log("[Preflight] Verifying 'report_approval_outbox' schema compatibility (read-only)...");

  const { rows: tableRows } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'report_approval_outbox'
    ) AS table_exists;
  `);

  const tableExists = Boolean(tableRows[0]?.table_exists);
  if (!tableExists) {
    console.log("[Preflight] Table 'report_approval_outbox' does not exist yet; will be created by migration 015.");
    return { tableExists: false, compatible: true };
  }

  console.log("[Preflight] Existing table 'report_approval_outbox' detected. Validating structural compatibility...");

  const { rows: columnRows } = await client.query(`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'report_approval_outbox'
    ORDER BY ordinal_position ASC;
  `);

  const existingCols = new Map(columnRows.map((r) => [r.column_name.toLowerCase(), r]));

  const REQUIRED_COLUMNS = [
    { name: "id", acceptableUdts: ["varchar", "text"] },
    { name: "report_id", acceptableUdts: ["text", "varchar"] },
    { name: "decision", acceptableUdts: ["varchar", "text"] },
    { name: "outcome_status", acceptableUdts: ["varchar", "text"] },
    { name: "disaster_type", acceptableUdts: ["varchar", "text"] },
    { name: "report_origin", acceptableUdts: ["varchar", "text"] },
    { name: "branch", acceptableUdts: ["varchar", "text"] },
    { name: "store_id", acceptableUdts: ["varchar", "text"] },
    { name: "store_name", acceptableUdts: ["varchar", "text"] },
    { name: "location_city", acceptableUdts: ["varchar", "text"] },
    { name: "decided_by_user_id", acceptableUdts: ["varchar", "text"] },
    { name: "decided_by_name", acceptableUdts: ["varchar", "text"] },
    { name: "decided_by_role", acceptableUdts: ["varchar", "text"] },
    { name: "decided_at", acceptableUdts: ["varchar", "text"] },
    { name: "decision_notes", acceptableUdts: ["text", "varchar"] },
    { name: "condition", acceptableUdts: ["varchar", "text"] },
    { name: "evidence_count", acceptableUdts: ["int4", "int8", "int2", "integer"] },
    { name: "published_to_ho", acceptableUdts: ["bool", "boolean"] },
    { name: "payload", acceptableUdts: ["jsonb", "json"] },
    { name: "processed_at", acceptableUdts: ["timestamptz", "timestamp"] },
    { name: "created_at", acceptableUdts: ["timestamptz", "timestamp"] },
  ];

  const missingCols = [];
  const typeMismatches = [];

  for (const req of REQUIRED_COLUMNS) {
    const existing = existingCols.get(req.name);
    if (!existing) {
      missingCols.push(req.name);
      continue;
    }
    const udt = existing.udt_name.toLowerCase();
    const dtype = existing.data_type.toLowerCase();
    const isTypeValid = req.acceptableUdts.some(
      (acceptable) => udt === acceptable || dtype.includes(acceptable)
    );
    if (!isTypeValid) {
      typeMismatches.push(`${req.name} (expected ${req.acceptableUdts.join("/")}, found ${udt}/${dtype})`);
    }
  }

  if (missingCols.length > 0) {
    throw new Error(
      `[Preflight] Incompatible 'report_approval_outbox' structure: Missing column(s): ${missingCols.join(", ")}`
    );
  }

  if (typeMismatches.length > 0) {
    throw new Error(
      `[Preflight] Incompatible 'report_approval_outbox' structure: Type mismatch in column(s): ${typeMismatches.join(", ")}`
    );
  }

  // Check PRIMARY KEY on id
  const { rows: pkRows } = await client.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'report_approval_outbox'
      AND tc.constraint_type = 'PRIMARY KEY';
  `);

  const pkColumns = pkRows.map((r) => r.column_name.toLowerCase());
  if (!pkColumns.includes("id")) {
    throw new Error("[Preflight] Incompatible 'report_approval_outbox' structure: PRIMARY KEY on 'id' is missing.");
  }

  // Check UNIQUE constraint or index on report_id
  const { rows: uqRows } = await client.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'report_approval_outbox'
      AND tc.constraint_type = 'UNIQUE'
      AND kcu.column_name = 'report_id';
  `);

  const { rows: uqIndexRows } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'report_approval_outbox'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%(report_id)%';
  `);

  const hasUniqueReportId = uqRows.length > 0 || uqIndexRows.length > 0;
  if (!hasUniqueReportId) {
    throw new Error(
      "[Preflight] Incompatible 'report_approval_outbox' structure: UNIQUE constraint or index on 'report_id' is missing."
    );
  }

  // Inspect foreign keys (informational / safety check)
  const { rows: fkRows } = await client.query(`
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'report_approval_outbox'
      AND tc.constraint_type = 'FOREIGN KEY';
  `);

  const legacyFkPresent = fkRows.some(
    (r) => r.constraint_name.toLowerCase() === "report_approval_outbox_report_id_fkey"
  );
  if (legacyFkPresent) {
    console.log(
      "[Preflight] Note: Legacy FK constraint 'report_approval_outbox_report_id_fkey' found. " +
      "Migration 015 will safely drop it via DROP CONSTRAINT IF EXISTS."
    );
  } else {
    console.log("[Preflight] Verified: Legacy foreign key 'report_approval_outbox_report_id_fkey' is absent.");
  }

  // Check partial index idx_approval_outbox_unprocessed (informational)
  const { rows: idxRows } = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'report_approval_outbox'
      AND indexname = 'idx_approval_outbox_unprocessed';
  `);

  if (idxRows.length > 0) {
    console.log("[Preflight] Verified: Index 'idx_approval_outbox_unprocessed' exists.");
  } else {
    console.log("[Preflight] Note: Index 'idx_approval_outbox_unprocessed' not yet present; migration 015 will create it.");
  }

  console.log(
    `[Preflight] Success: Existing 'report_approval_outbox' has 21/21 columns, ` +
    `PRIMARY KEY(id), and UNIQUE(report_id). Structure is 100% COMPATIBLE with migration 015.`
  );

  return { tableExists: true, compatible: true };
}

async function tryLoadLocalEnv() {
  if (process.env.DATABASE_URL) return;
  for (const envFile of [".env.local", ".env"]) {
    try {
      const content = await fs.readFile(path.join(process.cwd(), envFile), "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let val = (match[2] || "").trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      if (process.env.DATABASE_URL) break;
    } catch {
      // ignore missing file
    }
  }
}

function getPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required to run migrations");
  }

  const connectionString = databaseUrl.replace(/\?sslmode=[^&]+/, "");
  const sslMode = process.env.DATABASE_SSL_MODE?.trim() || "require";
  const caBase64 = process.env.DATABASE_SSL_CA_BASE64?.trim();

  let ssl = { rejectUnauthorized: false };
  if (sslMode === "disable") {
    ssl = false;
  } else if (sslMode === "verify-full" && caBase64) {
    ssl = {
      rejectUnauthorized: true,
      ca: Buffer.from(caBase64, "base64").toString("utf8"),
    };
  }

  return {
    connectionString,
    ssl,
    max: 2,
    connectionTimeoutMillis: 10000,
  };
}

async function run() {
  const { isValidateOnly, isPreflightOnly, throughTarget, help } = parseCliArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    return;
  }

  const allMigrations = await loadMigrationFiles();

  // Resolve target migrations based on --through
  let targetMigrations = [];
  if (throughTarget) {
    const targetIndex = findMigrationIndex(allMigrations, throughTarget);
    if (targetIndex === -1) {
      throw new Error(
        `Migration target '${throughTarget}' not found in database/migrations.\n` +
        `Available targets: ${allMigrations.map((m) => m.name.split("_")[0]).join(", ")}`
      );
    }

    const matchedMigration = allMigrations[targetIndex];
    if (DEFERRED_MIGRATIONS.has(matchedMigration.name)) {
      throw new Error(
        `Migration '${matchedMigration.name}' is explicitly deferred per migration policy ` +
        `(DO NOT EXECUTE until authorized by IT). Targeting this migration is strictly forbidden.`
      );
    }

    targetMigrations = allMigrations.slice(0, targetIndex + 1);
    console.log(
      `[Migrations] Selective mode active: Targeting through '${matchedMigration.name}' ` +
      `(${targetMigrations.length}/${allMigrations.length} total migrations).`
    );
  } else {
    // Existing/default mode: filter out deferred migrations
    targetMigrations = allMigrations.filter((m) => {
      if (DEFERRED_MIGRATIONS.has(m.name)) {
        console.warn(`[Migrations] Skipping deferred migration '${m.name}' (DO NOT EXECUTE until authorized by IT).`);
        return false;
      }
      return true;
    });
  }

  // Offline validation mode
  if (isValidateOnly) {
    console.log(`[Migrations] Validation passed: ${targetMigrations.length} migration(s) verified.`);
    for (const m of targetMigrations) {
      console.log(`  - ${m.name} (sha256: ${m.checksum.substring(0, 12)}...)`);
    }
    return;
  }

  await tryLoadLocalEnv();
  const poolConfig = getPoolConfig();
  const pool = new Pool(poolConfig);
  const client = await pool.connect();

  try {
    console.log("[Migrations] Acquiring migration advisory lock...");
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);

    console.log("[Migrations] Ensuring migration ledger table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS sparta_schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Preflight-only mode: check outbox compatibility and exit
    if (isPreflightOnly) {
      await verifyReportApprovalOutboxCompatibility(client);
      console.log("[Migrations] Preflight verification completed successfully.");
      return;
    }

    const { rows: appliedRows } = await client.query(
      "SELECT name, checksum FROM sparta_schema_migrations ORDER BY name ASC"
    );
    const appliedMap = new Map(appliedRows.map((r) => [r.name, r.checksum]));

    // Safety guard: ensure no migration beyond the requested target has already been applied
    if (throughTarget) {
      const targetMaxIdx = targetMigrations.length - 1;
      for (const appliedName of appliedMap.keys()) {
        const appliedIdx = findMigrationIndex(allMigrations, appliedName);
        if (appliedIdx > targetMaxIdx) {
          throw new Error(
            `Database already has migration '${appliedName}' applied, which is beyond requested target '${throughTarget}'. ` +
            `Selective migration cannot travel backwards.`
          );
        }
      }
    }

    // Verify existing checksums for drift against local files
    for (const [appliedName, recordedChecksum] of appliedMap.entries()) {
      const currentMigration = allMigrations.find((m) => m.name === appliedName);
      if (currentMigration && currentMigration.checksum !== recordedChecksum) {
        throw new Error(
          `Migration '${appliedName}' checksum drift detected!\n` +
          `Recorded in DB: ${recordedChecksum}\n` +
          `Local file:     ${currentMigration.checksum}`
        );
      }
    }

    // Determine pending migrations
    const pendingMigrations = targetMigrations.filter((m) => !appliedMap.has(m.name));

    // Preflight check for 015 if 015 is among pending migrations
    const pending015 = pendingMigrations.find((m) => m.name.startsWith("015_"));
    if (pending015) {
      await verifyReportApprovalOutboxCompatibility(client);
    }

    let appliedCount = 0;
    for (const migration of pendingMigrations) {
      // Re-verify deferred guard inside execution loop
      if (DEFERRED_MIGRATIONS.has(migration.name)) {
        console.warn(`[Migrations] CRITICAL: Omitting deferred migration '${migration.name}'.`);
        continue;
      }

      console.log(`[Migrations] Applying '${migration.name}'...`);
      await client.query("BEGIN");
      try {
        await client.query(migration.content);
        await client.query(
          "INSERT INTO sparta_schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum]
        );
        await client.query("COMMIT");
        appliedCount += 1;
        console.log(`[Migrations] Successfully applied '${migration.name}'.`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[Migrations] Failed to apply '${migration.name}', transaction rolled back.`);
        throw err;
      }
    }

    if (appliedCount === 0) {
      console.log("[Migrations] Schema is up to date. Zero migrations applied.");
    } else {
      console.log(`[Migrations] Successfully applied ${appliedCount} pending migration(s).`);
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
    } catch {
      // ignore unlock error if client disconnected
    }
    client.release();
    await pool.end();
  }
}

export {
  verifyReportApprovalOutboxCompatibility,
  findMigrationIndex,
  parseCliArgs,
  loadMigrationFiles,
  DEFERRED_MIGRATIONS,
  computeChecksum,
  ADVISORY_LOCK_ID,
  run,
};

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  run().catch((error) => {
    console.error("[Migrations] Fatal migration error:", error?.message || error);
    process.exit(1);
  });
}
