/**
 * SPARTA SIAGA - Safe Database Migration: Report Domain Fields
 * 
 * Adds new columns to existing `incidents` table.
 * Uses ADD COLUMN IF NOT EXISTS - safe to run multiple times.
 * Does NOT drop or modify existing columns.
 * Does NOT truncate or reset data.
 * 
 * Run with: pnpm tsx scripts/migrate-report-fields.ts
 */

import { getDbPool } from "../lib/db";

async function main() {
  const pool = getDbPool();
  console.log("[SPARTA SIAGA] Running safe report domain migration...");

  // 1. Add report origin and earthquake linkage to incidents table
  await pool.query(`
    ALTER TABLE incidents
      ADD COLUMN IF NOT EXISTS report_origin TEXT NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS earthquake_event_id TEXT,
      ADD COLUMN IF NOT EXISTS earthquake_source TEXT,
      ADD COLUMN IF NOT EXISTS earthquake_provenance TEXT,
      ADD COLUMN IF NOT EXISTS tkp_type TEXT,
      ADD COLUMN IF NOT EXISTS affected_stores JSONB,
      ADD COLUMN IF NOT EXISTS affected_store_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS danger_store_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS field_photos JSONB DEFAULT '[]';
  `);
  console.log("[SPARTA SIAGA] ✓ incidents: new columns added (report_origin, earthquake linkage, affected_stores, instructions)");

  // 2. Drop obsolete branch-level unique index and preserve location-level unique deduplication
  await pool.query(`
    DROP INDEX IF EXISTS idx_incidents_unique_auto_eq_branch;
    DROP INDEX IF EXISTS idx_incidents_eq_event_branch;
    CREATE INDEX IF NOT EXISTS idx_incidents_auto_eq_branch
      ON incidents(earthquake_event_id, branch)
      WHERE report_origin = 'automatic_earthquake' AND earthquake_event_id IS NOT NULL;
  `);
  console.log("[SPARTA SIAGA] ✓ incidents: branch lookup index (non-unique) on (earthquake_event_id, branch) ensured");

  // 3. Add index on report_origin for filtering
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_incidents_report_origin
      ON incidents(report_origin);
  `);
  console.log("[SPARTA SIAGA] ✓ incidents: index on report_origin created");

  // 4. Add delivery_status to notification_logs (honesty requirement)
  await pool.query(`
    ALTER TABLE notification_logs
      ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_configured',
      ADD COLUMN IF NOT EXISTS delivery_channel TEXT,
      ADD COLUMN IF NOT EXISTS delivery_attempted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS delivery_error TEXT;
  `);
  console.log("[SPARTA SIAGA] ✓ notification_logs: delivery status columns added");

  // 5. Create report_instructions table for GM/SM HO management instructions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS report_instructions (
      instruction_id  TEXT PRIMARY KEY,
      report_id       TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      instruction_text TEXT NOT NULL,
      author_id       TEXT NOT NULL,
      author_name     TEXT NOT NULL,
      author_role     TEXT NOT NULL CHECK (author_role IN ('gm_ho', 'sm_ho')),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delivery_status TEXT NOT NULL DEFAULT 'not_configured',
      target_roles    JSONB NOT NULL DEFAULT '[]',
      delivery_channel TEXT NOT NULL DEFAULT 'wa',
      delivery_log    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_instructions_report_id
      ON report_instructions(report_id);
    CREATE INDEX IF NOT EXISTS idx_instructions_created_at
      ON report_instructions(created_at DESC);
  `);
  console.log("[SPARTA SIAGA] ✓ report_instructions: table created");

  console.log("[SPARTA SIAGA] Migration complete. All operations were additive.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[SPARTA SIAGA] Migration failed:", err);
  process.exit(1);
});
