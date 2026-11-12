-- Migration 016: Session Concurrency Protection & Current Token Encryption
-- Purpose: Store encrypted active refresh token to allow safe concurrent grace-period rotation
-- without overwriting client cookies with stale/expired tokens.

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS current_token_encrypted TEXT;

-- Composite index to accelerate concurrent rotation and grace-period lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_token_grace 
  ON user_sessions (previous_refresh_token_hash, previous_token_expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_active_lookup
  ON user_sessions (refresh_token_hash, is_revoked, expires_at);

