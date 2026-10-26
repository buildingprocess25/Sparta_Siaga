DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS earthquake_reconciliation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES earthquake_reconciliation_cases(id) ON DELETE RESTRICT,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  action VARCHAR(16) NOT NULL CHECK (action IN ('LINK', 'DISMISS')),
  previous_identity JSONB NOT NULL,
  resulting_identity JSONB NOT NULL,
  actor_user_id VARCHAR(64) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_audit_case
  ON earthquake_reconciliation_audit(case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_repair_link_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE RESTRICT,
  repair_reference_id VARCHAR(128) NOT NULL,
  action VARCHAR(16) NOT NULL CHECK (action IN ('LINK', 'UNLINK')),
  actor_user_id VARCHAR(64) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repair_link_history_incident
  ON incident_repair_link_history(incident_id, created_at DESC);
