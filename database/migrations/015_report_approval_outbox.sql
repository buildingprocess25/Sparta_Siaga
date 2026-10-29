DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS report_approval_outbox (
  id VARCHAR(128) PRIMARY KEY,
  report_id TEXT NOT NULL,
  decision VARCHAR(32) NOT NULL CHECK (decision IN ('approved', 'safe')),
  outcome_status VARCHAR(64) NOT NULL,
  disaster_type VARCHAR(64) NOT NULL,
  report_origin VARCHAR(64),
  branch VARCHAR(64) NOT NULL,
  store_id VARCHAR(64),
  store_name VARCHAR(255),
  location_city VARCHAR(128),
  decided_by_user_id VARCHAR(64) NOT NULL,
  decided_by_name VARCHAR(255) NOT NULL,
  decided_by_role VARCHAR(64) NOT NULL,
  decided_at VARCHAR(64) NOT NULL,
  decision_notes TEXT,
  condition VARCHAR(32) NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  published_to_ho BOOLEAN NOT NULL DEFAULT TRUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_report_approval_outbox_report UNIQUE(report_id)
);

ALTER TABLE report_approval_outbox DROP CONSTRAINT IF EXISTS report_approval_outbox_report_id_fkey;

CREATE INDEX IF NOT EXISTS idx_approval_outbox_unprocessed
  ON report_approval_outbox(created_at)
  WHERE processed_at IS NULL;
