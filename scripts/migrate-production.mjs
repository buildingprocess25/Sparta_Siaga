#!/usr/bin/env node

/**
 * SPARTA SIAGA - Production Migration Runner
 *
 * Runs ordered, locked, repeatable, additive schema migrations.
 * Uses only runtime dependencies ('pg' and Node.js built-ins).
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Pool } from "pg";

const ADVISORY_LOCK_ID = 7421839;
const MIGRATIONS_DIR = path.join(process.cwd(), "database", "migrations");
const FILENAME_REGEX = /^\d{3}_[\w-]+\.sql$/;

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
  const isValidateOnly = process.argv.includes("--validate-only");
  const migrations = await loadMigrationFiles();

  if (isValidateOnly) {
    console.log(`[Migrations] Validation passed: ${migrations.length} migration(s) verified.`);
    for (const m of migrations) {
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

    const { rows: appliedRows } = await client.query(
      "SELECT name, checksum FROM sparta_schema_migrations ORDER BY name ASC"
    );
    const appliedMap = new Map(appliedRows.map((r) => [r.name, r.checksum]));

    // Verify existing checksums for drift
    for (const [appliedName, recordedChecksum] of appliedMap.entries()) {
      const currentMigration = migrations.find((m) => m.name === appliedName);
      if (currentMigration && currentMigration.checksum !== recordedChecksum) {
        throw new Error(
          `Migration '${appliedName}' checksum drift detected!\n` +
          `Recorded in DB: ${recordedChecksum}\n` +
          `Local file:     ${currentMigration.checksum}`
        );
      }
    }

    let appliedCount = 0;
    for (const migration of migrations) {
      if (appliedMap.has(migration.name)) {
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

run().catch((error) => {
  console.error("[Migrations] Fatal migration error:", error?.message || error);
  process.exit(1);
});
