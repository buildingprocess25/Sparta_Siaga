ALTER TABLE users ADD COLUMN IF NOT EXISTS last_provisioned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_portal_branch JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_portal_id ON users(external_user_id)
  WHERE external_user_id IS NOT NULL AND external_user_id <> '';
CREATE TABLE IF NOT EXISTS sparta_provisioning_state (
  external_user_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);
