-- ============================================================================
-- SPARTA SIAGA — 014_system_settings_and_testing_mode.sql
-- System settings, testing mode toggle state, and system audit logs.
-- ============================================================================

-- 1. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(64)
);

-- Seed default testing_mode to OFF (production safe)
INSERT INTO system_settings (key, value, updated_at, updated_by)
VALUES ('testing_mode', '{"enabled": false}'::jsonb, NOW(), 'SYSTEM')
ON CONFLICT (key) DO NOTHING;

-- 2. SYSTEM AUDIT LOGS
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(64) NOT NULL,
  target VARCHAR(64) NOT NULL,
  details JSONB,
  actor_user_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_audit_action ON system_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_audit_created ON system_audit_logs(created_at DESC);
