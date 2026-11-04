-- Migration 017: Earthquake ShakeMaps and Facility Intensities
-- Purpose: Support Earthquake Intensity Two-Stage Pipeline (ShakeMap CovJSON/Grid ingestion & facility evaluation)
-- Safety: Additive only, no destructive alterations to existing tables.

CREATE TABLE IF NOT EXISTS earthquake_shakemaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_event_id VARCHAR(128) NOT NULL,
    source_provider VARCHAR(32) NOT NULL, -- 'USGS' | 'BMKG'
    version_number INTEGER NOT NULL DEFAULT 1,
    product_type VARCHAR(32) NOT NULL DEFAULT 'covjson', -- 'covjson' | 'grid_xml'
    grid_bounds_x_min DOUBLE PRECISION NOT NULL,
    grid_bounds_x_max DOUBLE PRECISION NOT NULL,
    grid_bounds_y_min DOUBLE PRECISION NOT NULL,
    grid_bounds_y_max DOUBLE PRECISION NOT NULL,
    grid_num_x INTEGER NOT NULL,
    grid_num_y INTEGER NOT NULL,
    max_mmi DOUBLE PRECISION NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    storage_path VARCHAR(255),
    raw_payload JSONB,
    evaluation_status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ,
    error_message TEXT,
    CONSTRAINT uq_earthquake_shakemaps_version UNIQUE (canonical_event_id, source_provider, version_number)
);

CREATE INDEX IF NOT EXISTS idx_shakemaps_canonical_event ON earthquake_shakemaps(canonical_event_id);
CREATE INDEX IF NOT EXISTS idx_shakemaps_evaluation_status ON earthquake_shakemaps(evaluation_status);

CREATE TABLE IF NOT EXISTS earthquake_facility_intensities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shakemap_id UUID NOT NULL REFERENCES earthquake_shakemaps(id) ON DELETE CASCADE,
    canonical_event_id VARCHAR(128) NOT NULL,
    facility_kind VARCHAR(16) NOT NULL, -- 'STORE' | 'FACILITY'
    facility_id VARCHAR(64) NOT NULL,
    facility_code VARCHAR(32) NOT NULL,
    facility_name VARCHAR(255),
    branch VARCHAR(64) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    distance_km DOUBLE PRECISION NOT NULL,
    mmi_raw DOUBLE PRECISION, -- Full precision unrounded float (null if outside coverage)
    mmi_rounded NUMERIC(4, 2), -- 2 decimal places for UI display
    mmi_roman VARCHAR(8) NOT NULL,
    decision_policy VARCHAR(32) NOT NULL, -- 'CANDIDATE_AUTO_REPORT', 'NOTIFICATION_ONLY', 'UNKNOWN'
    discrepancy_vs_radius VARCHAR(32) NOT NULL, -- 'CONCORDANT_HIGH_RISK', 'CONCORDANT_LOW_RISK', 'RADIUS_OVERPREDICTION_VS_MMI', 'RADIUS_UNDERPREDICTION_VS_MMI', 'OUT_OF_SHAKEMAP_COVERAGE'
    shakemap_version INTEGER NOT NULL DEFAULT 1,
    incident_id VARCHAR(64) REFERENCES incidents(id) ON DELETE SET NULL,
    notes TEXT,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shakemap_facility_version UNIQUE (shakemap_id, facility_kind, facility_id, shakemap_version)
);

CREATE INDEX IF NOT EXISTS idx_facility_intensities_event_branch ON earthquake_facility_intensities(canonical_event_id, branch);
CREATE INDEX IF NOT EXISTS idx_facility_intensities_decision ON earthquake_facility_intensities(decision_policy);
CREATE INDEX IF NOT EXISTS idx_facility_intensities_incident ON earthquake_facility_intensities(incident_id) WHERE incident_id IS NOT NULL;
