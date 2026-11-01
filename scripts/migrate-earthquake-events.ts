/**
 * SPARTA SIAGA - Database Migration: Persistent Earthquake Events
 * 
 * Creates table `earthquake_events` for long-term audit and history.
 * Non-destructive and idempotent (IF NOT EXISTS).
 * 
 * Run with: pnpm dlx tsx scripts/migrate-earthquake-events.ts
 */

import { getDbPool } from "../lib/db";

export async function migrateEarthquakeEvents(): Promise<void> {
  const pool = getDbPool();
  console.log("[SPARTA SIAGA] Running persistent earthquake events migration...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS earthquake_events (
      id VARCHAR(128) PRIMARY KEY, -- canonical_event_key e.g. bmkg-2026-10-06T04:20:00Z or usgs-us6000xyz
      provider_event_id VARCHAR(128),
      source_primary VARCHAR(32) NOT NULL, -- 'BMKG' | 'USGS'
      magnitude NUMERIC(3, 1) NOT NULL,
      depth_km INT NOT NULL,
      latitude NUMERIC(8, 5) NOT NULL,
      longitude NUMERIC(8, 5) NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      title TEXT NOT NULL,
      potensi_tsunami BOOLEAN NOT NULL DEFAULT FALSE,
      potensi_text TEXT,
      felt_area TEXT,
      shakemap_url TEXT,
      priority_radius_km INT NOT NULL,
      monitoring_radius_km INT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_metadata JSONB DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_eq_events_occurred_at ON earthquake_events(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eq_events_source ON earthquake_events(source_primary);
    CREATE INDEX IF NOT EXISTS idx_eq_events_coords ON earthquake_events(latitude, longitude);
  `);

  console.log("[SPARTA SIAGA] ✓ Table earthquake_events ready!");
}

if (process.argv[1]?.includes("migrate-earthquake-events")) {
  migrateEarthquakeEvents()
    .then(() => {
      console.log("[SPARTA SIAGA] Migration completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[SPARTA SIAGA] Migration error:", err);
      process.exit(1);
    });
}
