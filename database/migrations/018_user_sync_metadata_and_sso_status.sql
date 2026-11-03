-- ============================================================================
-- SPARTA SIAGA — 018_user_sync_metadata_and_sso_status.sql
-- Additive, non-breaking schema additions for SPARTA Ecosystem User Sync:
-- 1. sso_status: Tracks SSO readiness (PENDING_SSO_GRANT, UNMATCHED_SSO, PENDING_REVIEW, BLOCKED, ACTIVE)
--    Defaults to NULL for legacy/existing accounts so they are not misclassified as pending.
-- 2. secondary_branches: JSONB array of secondary branch codes/facilities (e.g. WH, Depo, DC)
-- 3. multi_roles: JSONB array of multi-role assignments from other modules
-- 4. sync_metadata: JSONB object for audit tracking, source sync timestamps, review reasons
--
-- NOTE: Prepared for Task 1 User Sync. DO NOT EXECUTE until authorized by IT.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS sso_status VARCHAR(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS secondary_branches JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS multi_roles JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_metadata JSONB DEFAULT '{}'::jsonb;

-- Performance and lookup indexes for idempotent synchronization
CREATE INDEX IF NOT EXISTS idx_users_sso_status ON public.users(sso_status);
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON public.users(LOWER(TRIM(email)));

