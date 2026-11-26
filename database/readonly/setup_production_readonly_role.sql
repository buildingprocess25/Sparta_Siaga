-- ============================================================================
-- SPARTA SIAGA — Provisioning Role PostgreSQL Read-Only untuk Development
-- Jalankan SEKALI oleh DBA pada database PostgreSQL Production.
-- JANGAN dieksekusi dari aplikasi atau migration otomatis.
-- Ganti <STRONG_READONLY_PASSWORD> sebelum dijalankan.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sparta_siaga_readonly') THEN
    CREATE ROLE sparta_siaga_readonly WITH
      LOGIN
      PASSWORD '<STRONG_READONLY_PASSWORD>'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE sparta_siaga_readonly SET default_transaction_read_only = on;
ALTER ROLE sparta_siaga_readonly SET statement_timeout = '15s';

REVOKE ALL PRIVILEGES ON DATABASE siaga FROM sparta_siaga_readonly;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM sparta_siaga_readonly;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM sparta_siaga_readonly;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM sparta_siaga_readonly;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM sparta_siaga_readonly;

GRANT CONNECT ON DATABASE siaga TO sparta_siaga_readonly;
GRANT USAGE ON SCHEMA public TO sparta_siaga_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sparta_siaga_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO sparta_siaga_readonly;
