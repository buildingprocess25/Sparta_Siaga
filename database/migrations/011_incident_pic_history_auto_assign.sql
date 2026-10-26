DO $$
BEGIN
  IF current_database() = 'defaultdb' THEN
    RAISE EXCEPTION 'Refusing migration: direct mutation of staging defaultdb is prohibited';
  END IF;
END $$;

ALTER TABLE incident_pic_history DROP CONSTRAINT IF EXISTS incident_pic_history_action_check;
ALTER TABLE incident_pic_history ADD CONSTRAINT incident_pic_history_action_check
  CHECK (action IN ('CLAIM', 'ASSIGN', 'TRANSFER', 'RELEASE', 'AUTO_ASSIGN'));
