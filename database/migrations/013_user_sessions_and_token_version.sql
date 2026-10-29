-- ============================================================================
-- SPARTA SIAGA — 013_user_sessions_and_token_version.sql
-- Add token_version column to users table and create user_sessions table
-- for persistent multi-device authentication with grace-period rotation.
-- ============================================================================

-- 1. Ensure token_version on users table for global multi-device revocation
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1;

-- 2. Ensure user_sessions table for per-device persistent sessions
CREATE TABLE IF NOT EXISTS public.user_sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    refresh_token_hash VARCHAR(64) NOT NULL UNIQUE,
    previous_refresh_token_hash VARCHAR(64),
    previous_token_expires_at TIMESTAMPTZ,
    device_type VARCHAR(32) DEFAULT 'unknown',
    user_agent TEXT,
    ip_address VARCHAR(64),
    token_version INTEGER DEFAULT 1,
    is_revoked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 3. Idempotently ensure columns if table pre-existed
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS previous_refresh_token_hash VARCHAR(64);
ALTER TABLE public.user_sessions ADD COLUMN IF NOT EXISTS previous_token_expires_at TIMESTAMPTZ;

-- 4. Essential lookup and expiration indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_hash ON public.user_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_prev_hash ON public.user_sessions(previous_refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON public.user_sessions(expires_at);
