ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_provisioned_at TIMESTAMPTZ;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS branch_code TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS master_source TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS master_synced_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS branch_code TEXT;

CREATE INDEX IF NOT EXISTS idx_users_portal_branch ON users(branch_code);
CREATE INDEX IF NOT EXISTS idx_stores_portal_branch ON stores(branch_code);
CREATE INDEX IF NOT EXISTS idx_incidents_portal_branch ON incidents(branch_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_portal_id ON users(external_user_id)
  WHERE external_user_id IS NOT NULL AND external_user_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_portal_code ON stores(kode_toko);

CREATE TABLE IF NOT EXISTS sparta_master_branches (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(aliases) = 'array')
);

CREATE TABLE IF NOT EXISTS sparta_master_sync_state (
  resource TEXT PRIMARY KEY,
  synced_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sparta_provisioning_state (
  external_user_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS store_sync_history (
  id TEXT PRIMARY KEY, sync_source TEXT NOT NULL, status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ,
  records_read INTEGER DEFAULT 0, records_added INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0, records_skipped INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0, error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION sparta_resolve_branch(raw_value TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE resolved TEXT; matches INTEGER; tier INTEGER;
BEGIN
  IF raw_value IS NULL OR BTRIM(raw_value) = '' THEN RETURN NULL; END IF;
  FOR tier IN 1..3 LOOP
    SELECT MIN(b.code), COUNT(*) INTO resolved, matches
    FROM sparta_master_branches b
    WHERE CASE tier
      WHEN 1 THEN UPPER(BTRIM(b.code)) = UPPER(REGEXP_REPLACE(BTRIM(raw_value), '\s+', ' ', 'g'))
      WHEN 2 THEN UPPER(REGEXP_REPLACE(BTRIM(b.name), '\s+', ' ', 'g')) = UPPER(REGEXP_REPLACE(BTRIM(raw_value), '\s+', ' ', 'g'))
      ELSE EXISTS (SELECT 1 FROM jsonb_array_elements_text(b.aliases) a(value)
        WHERE UPPER(REGEXP_REPLACE(BTRIM(a.value), '\s+', ' ', 'g')) = UPPER(REGEXP_REPLACE(BTRIM(raw_value), '\s+', ' ', 'g')))
      END;
    IF matches > 1 THEN RAISE EXCEPTION 'AMBIGUOUS_BRANCH: %', raw_value; END IF;
    IF matches = 1 THEN RETURN resolved; END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION sparta_branch_key(raw_value TEXT) RETURNS TEXT
LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(sparta_resolve_branch(raw_value), UPPER(REGEXP_REPLACE(BTRIM(raw_value), '\s+', ' ', 'g')))
$$;

CREATE OR REPLACE FUNCTION sparta_fill_branch_code() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE branch_text TEXT; code_changed BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'stores' THEN branch_text := NEW.cabang;
  ELSE branch_text := NEW.branch; END IF;
  code_changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN code_changed := NEW.branch_code IS DISTINCT FROM OLD.branch_code; END IF;
  IF code_changed AND NEW.branch_code IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM sparta_master_branches WHERE code = NEW.branch_code) THEN
      RAISE EXCEPTION 'UNKNOWN_PORTAL_BRANCH_CODE: %', NEW.branch_code;
    END IF;
  ELSE
    NEW.branch_code := sparta_resolve_branch(branch_text);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS users_portal_branch ON users;
CREATE TRIGGER users_portal_branch BEFORE INSERT OR UPDATE OF branch, branch_code ON users
  FOR EACH ROW EXECUTE FUNCTION sparta_fill_branch_code();
DROP TRIGGER IF EXISTS stores_portal_branch ON stores;
CREATE TRIGGER stores_portal_branch BEFORE INSERT OR UPDATE OF cabang, branch_code ON stores
  FOR EACH ROW EXECUTE FUNCTION sparta_fill_branch_code();
DROP TRIGGER IF EXISTS incidents_portal_branch ON incidents;
CREATE TRIGGER incidents_portal_branch BEFORE INSERT OR UPDATE OF branch, branch_code ON incidents
  FOR EACH ROW EXECUTE FUNCTION sparta_fill_branch_code();

CREATE OR REPLACE FUNCTION sparta_normalize_existing_branch_code() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE resolved TEXT;
BEGIN
  IF NEW.branch_code IS NULL OR BTRIM(NEW.branch_code) = '' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM sparta_master_branches) THEN RETURN NEW; END IF;
  resolved := sparta_resolve_branch(NEW.branch_code);
  IF resolved IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PORTAL_BRANCH_CODE: %', NEW.branch_code; END IF;
  NEW.branch_code := resolved;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS approvals_portal_branch ON report_completion_approvals;
CREATE TRIGGER approvals_portal_branch BEFORE INSERT OR UPDATE OF branch_code ON report_completion_approvals
  FOR EACH ROW EXECUTE FUNCTION sparta_normalize_existing_branch_code();
DROP TRIGGER IF EXISTS overrides_portal_branch ON user_permission_overrides;
CREATE TRIGGER overrides_portal_branch BEFORE INSERT OR UPDATE OF branch_code ON user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION sparta_normalize_existing_branch_code();
DROP TRIGGER IF EXISTS permission_logs_portal_branch ON permission_audit_logs;
CREATE TRIGGER permission_logs_portal_branch BEFORE INSERT OR UPDATE OF branch_code ON permission_audit_logs
  FOR EACH ROW EXECUTE FUNCTION sparta_normalize_existing_branch_code();
