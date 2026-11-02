/**
 * SPARTA SIAGA - Isolated Database Migration Deployer
 * Migration: 017_earthquake_shakemaps_and_facility_intensities.sql
 * 
 * Safety: Strictly targets sparta_siaga_isolated on Aiven.
 * Fails closed if target is not sparta_siaga_isolated.
 */

import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertIsolatedDatabase } from "../lib/database-safety";

function getIsolatedDbUrl(): string {
  const envContent = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  let isolatedUrl = "";
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^\s*SPARTA_ISOLATED_TEST_DATABASE_URL\s*=\s*(.*)?\s*$/);
    if (match) {
      isolatedUrl = match[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }

  if (!isolatedUrl) {
    throw new Error("SPARTA_ISOLATED_TEST_DATABASE_URL not found in .env.local");
  }

  const parsed = new URL(isolatedUrl);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (dbName !== "sparta_siaga_isolated") {
    throw new Error(`Target is NOT sparta_siaga_isolated (found: ${dbName})! Aborting for safety.`);
  }

  console.log(`[Isolated DB Deploy] Target host: ${parsed.hostname}`);
  console.log(`[Isolated DB Deploy] Target database: ${dbName}`);
  return isolatedUrl;
}

async function main() {
  const isolatedUrl = getIsolatedDbUrl();
  const cleanConnString = isolatedUrl.replace(/\?sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: cleanConnString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    await assertIsolatedDatabase(client);

    const currentDb = (await client.query("SELECT current_database();")).rows[0].current_database;
    console.log(`[Isolated DB Deploy] Connected to: ${currentDb}`);

    // Ensure migration tracker table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS sparta_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Load migration 017
    const migrationName = "017_earthquake_shakemaps_and_facility_intensities.sql";
    const migrationFile = path.join(process.cwd(), "database", "migrations", migrationName);
    const sql = fs.readFileSync(migrationFile, "utf8");
    const checksum = crypto.createHash("sha256").update(sql, "utf8").digest("hex");

    console.log(`[Isolated DB Deploy] Applying ${migrationName}...`);
    await client.query("BEGIN;");
    await client.query(sql);
    await client.query(
      `INSERT INTO sparta_schema_migrations (name, checksum, applied_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW();`,
      [migrationName, checksum]
    );
    await client.query("COMMIT;");
    console.log(`[Isolated DB Deploy] Successfully applied and recorded ${migrationName}.`);
  } catch (err) {
    await client.query("ROLLBACK;").catch(() => {});
    console.error("[Isolated DB Deploy] Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Fatal deployment error:", err);
  process.exit(1);
});

