/**
 * SPARTA SIAGA — Standalone Staging Session Schema Migration
 * 
 * Prepares the user_sessions table and users.token_version column.
 * Strictly decoupled from runtime authentication to guarantee ZERO runtime DDL execution.
 * Protected by assertIsolatedDatabase() to ensure production databases are never touched.
 */

import { fileURLToPath } from "url";
import { getDbPool } from "../lib/db";
import { assertIsolatedDatabase } from "../lib/database-safety";
import { ensureUserSessionsTable } from "../lib/session-service";

async function runSessionSchemaMigration(options: { closePool?: boolean } = {}) {
  console.log("=== SPARTA SIAGA Session Schema Migration ===");
  const pool = getDbPool();

  try {
    console.log("[Safety Check] Verifying target database isolation...");
    await assertIsolatedDatabase(pool);
    console.log("[Safety Check] Database isolation verified. Target is safe staging/isolated database.");

    console.log("[Migration] Executing ensureUserSessionsTable()...");
    await ensureUserSessionsTable();
    console.log("[Migration] Migration completed successfully.");

    // Verify table structure
    const checkRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_sessions' 
      ORDER BY ordinal_position
    `);
    console.log(`[Verification] user_sessions table verified with ${checkRes.rowCount} columns.`);
  } catch (error) {
    console.error("[Migration Error] Failed to run session schema migration:", error);
    throw error;
  } finally {
    if (options.closePool) {
      await pool.end();
    }
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  runSessionSchemaMigration({ closePool: true }).catch(() => process.exit(1));
}

export { runSessionSchemaMigration };
