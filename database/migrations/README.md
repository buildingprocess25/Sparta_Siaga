# SPARTA SIAGA — Production Database Migrations

This directory contains ordered, repeatable, additive schema migrations for SPARTA SIAGA.

## Principles & Guardrails

1. **Strictly Additive**: Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`.
2. **Zero Destructive Operations**: Never include `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or destructive type alterations.
3. **No Test or Seed Data**: Migrations must define schema and structure only; no test data or mock users.
4. **Idempotent & Atomic**: Each migration is executed inside a single transaction and tracked in `sparta_schema_migrations`.
5. **Advisory Locking**: The migration runner acquires an advisory lock (`pg_advisory_lock`) to prevent concurrent execution races.
6. **Checksum Integrity**: SHA-256 checksums are calculated and verified against previously applied migrations to detect drift.
7. **Selective Migration & Deferral Guards**: Supports `--through=<target>` to safely boundary releases, with automatic exclusion of deferred migrations (such as 018).

## Running Migrations

To apply pending migrations to the configured database:

```bash
pnpm run db:deploy
```

To run selective deployment (e.g. up to migration 017):

```bash
node scripts/migrate-production.mjs --through=017
# or via pnpm
pnpm run db:deploy -- --through=017
```

To run read-only preflight checks (e.g. verifying `report_approval_outbox` structure):

```bash
node scripts/migrate-production.mjs --preflight-only
```

To validate migration syntax and file checksums offline:

```bash
node scripts/migrate-production.mjs --validate-only
# or validate selective target
node scripts/migrate-production.mjs --validate-only --through=017
```
