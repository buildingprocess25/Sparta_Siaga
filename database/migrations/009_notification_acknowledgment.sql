DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS acknowledgment_notes TEXT;
