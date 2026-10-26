DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  initials VARCHAR(32),
  facility_type VARCHAR(32) NOT NULL CHECK (facility_type IN ('DC', 'WAREHOUSE', 'DEPO', 'BULKY', 'STORE_HUB')),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  branch_id VARCHAR(64),
  mapping_verified_at TIMESTAMPTZ,
  mapping_verified_by VARCHAR(64),
  operational_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (operational_status IN ('ACTIVE', 'INACTIVE')),
  auto_report_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  source_name VARCHAR(128) NOT NULL,
  source_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT facilities_auto_report_mapping_ck CHECK (
    NOT auto_report_enabled OR (branch_id IS NOT NULL AND mapping_verified_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(facility_type);
CREATE INDEX IF NOT EXISTS idx_facilities_branch ON facilities(branch_id);
CREATE INDEX IF NOT EXISTS idx_facilities_worker ON facilities(auto_report_enabled, operational_status)
  WHERE auto_report_enabled = TRUE AND operational_status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS facility_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name VARCHAR(128) NOT NULL,
  mode VARCHAR(16) NOT NULL CHECK (mode IN ('PREVIEW', 'APPLY')),
  total_count INTEGER NOT NULL,
  new_count INTEGER NOT NULL,
  changed_count INTEGER NOT NULL,
  unchanged_count INTEGER NOT NULL,
  invalid_count INTEGER NOT NULL,
  invalid_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_by VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS facility_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
  import_run_id UUID REFERENCES facility_import_runs(id) ON DELETE SET NULL,
  action VARCHAR(32) NOT NULL,
  changed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facility_audit_facility ON facility_audit_logs(facility_id, created_at DESC);

CREATE TABLE IF NOT EXISTS earthquake_source_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_event_id VARCHAR(128) NOT NULL REFERENCES earthquake_events(id) ON DELETE RESTRICT,
  provider VARCHAR(32) NOT NULL,
  provider_event_id VARCHAR(128) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  magnitude NUMERIC(3,1) NOT NULL,
  depth_km NUMERIC(7,2),
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS idx_eq_source_canonical ON earthquake_source_events(canonical_event_id);

ALTER TABLE incidents ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN store_name DROP NOT NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS canonical_event_id VARCHAR(128);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_kind VARCHAR(16);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_id VARCHAR(128);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_code_snapshot VARCHAR(64);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_name_snapshot VARCHAR(255);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_type_snapshot VARCHAR(32);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS latitude_snapshot DOUBLE PRECISION;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS longitude_snapshot DOUBLE PRECISION;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS branch_snapshot VARCHAR(64);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS primary_pic_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS primary_pic_claimed_at TIMESTAMPTZ;

UPDATE incidents
SET canonical_event_id = earthquake_event_id,
    location_kind = 'STORE',
    location_id = store_id,
    location_code_snapshot = COALESCE(location_code_snapshot, store_id),
    location_name_snapshot = COALESCE(location_name_snapshot, store_name),
    location_type_snapshot = COALESCE(location_type_snapshot, 'STORE'),
    branch_snapshot = COALESCE(branch_snapshot, branch)
WHERE earthquake_event_id IS NOT NULL
  AND store_id IS NOT NULL
  AND location_kind IS NULL;

ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_location_identity_ck;
ALTER TABLE incidents ADD CONSTRAINT incidents_location_identity_ck CHECK (
  (location_kind IS NULL AND location_id IS NULL)
  OR (location_kind IN ('STORE', 'FACILITY') AND location_id IS NOT NULL)
) NOT VALID;
ALTER TABLE incidents VALIDATE CONSTRAINT incidents_location_identity_ck;

DROP INDEX IF EXISTS idx_incidents_unique_auto_eq_store;
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_unique_earthquake_location
  ON incidents(canonical_event_id, location_kind, location_id)
  WHERE disaster_type = 'earthquake'
    AND canonical_event_id IS NOT NULL
    AND location_kind IS NOT NULL
    AND location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_shared_queue
  ON incidents(branch, location_kind, status, created_at)
  WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS earthquake_reconciliation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  candidate_canonical_event_id VARCHAR(128) REFERENCES earthquake_events(id) ON DELETE RESTRICT,
  candidate_location_kind VARCHAR(16),
  candidate_location_id VARCHAR(128),
  reason VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolved_by VARCHAR(64),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_open_candidate
  ON earthquake_reconciliation_cases(incident_id, candidate_canonical_event_id, candidate_location_kind, candidate_location_id)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS incident_pic_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  action VARCHAR(16) NOT NULL CHECK (action IN ('CLAIM', 'TRANSFER', 'RELEASE')),
  from_user_id VARCHAR(64),
  to_user_id VARCHAR(64),
  actor_user_id VARCHAR(64) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pic_history_incident ON incident_pic_history(incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_repair_links (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  repair_reference_id VARCHAR(128) NOT NULL,
  verified_by VARCHAR(64) NOT NULL,
  verification_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (incident_id, repair_reference_id)
);

CREATE OR REPLACE FUNCTION lock_earthquake_location(
  p_canonical_event_id TEXT,
  p_location_kind TEXT,
  p_location_id TEXT
) RETURNS VOID
LANGUAGE SQL
AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended(p_canonical_event_id || ':' || p_location_kind || ':' || p_location_id, 0)
  );
$$;
