DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS store_verifications JSONB DEFAULT '{}'::jsonb;
