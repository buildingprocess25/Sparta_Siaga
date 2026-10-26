DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS canonical_event_id VARCHAR(128);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS recipient_group VARCHAR(32);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS notification_category VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_event_branch_group
  ON notification_logs(canonical_event_id, branch, recipient_group, notification_category)
  WHERE canonical_event_id IS NOT NULL
    AND recipient_group IS NOT NULL
    AND notification_category IS NOT NULL;
