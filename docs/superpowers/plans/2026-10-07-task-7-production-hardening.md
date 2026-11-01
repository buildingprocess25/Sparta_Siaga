# Task 7 Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SPARTA SIAGA safely and repeatably deployable to Dokploy without changing Task 1–6 business behavior.

**Architecture:** Build one non-root Next.js standalone container from a pinned multi-stage Dockerfile, retain the external PostgreSQL database, and mount a Dokploy-backed named volume at `/app/storage`. Central server-only configuration validates production secrets and infrastructure settings; explicit migrations, health probes, graceful shutdown, backup/restore helpers, and Dokploy documentation form the operational contract.

**Tech Stack:** Next.js 16 App Router, Node.js 24, pnpm 11, PostgreSQL via `pg`, Docker Compose, Dokploy/Traefik, TypeScript verification scripts.

## Global Constraints

- Do not change Task 1–6 business flow, lifecycle transitions, roles, permissions, notification authorization, or persona behavior.
- Do not add real credentials or production domains to the repository.
- Do not reset, drop, truncate, or destructively rewrite production data.
- Keep readiness and progress evidence outside `public/` and persistent across deployments.
- Production-critical configuration must fail fast; development may retain explicitly marked local conveniences.
- Production secrets are runtime-only and must never be required by an image build stage or persisted in an image layer/build argument.
- Classify `SPARTA_API_URL`, `SPARTA_LOGIN_URL`, and `NEXT_PUBLIC_APP_URL` only after auditing their actual consumers; do not make unused or optional integrations startup blockers.
- Inventory every persistent user-generated artefact, including readiness, progress, final/completion/handover evidence, avatars, and legacy public uploads.
- Do not force a read-only root filesystem until Next.js/native-library temporary-write behavior is proven compatible.
- Final diff and secret review use pre-Task-7 baseline `46952b8`, not `HEAD~1`.
- Task 7 ends after reporting and must not start Task 8.

---

### Task 1: Establish the Task 7 RED verification suite

**Files:**
- Create: `scripts/test-production-readiness-task7.ts`
- Read: `docs/superpowers/specs/2026-10-07-task-7-production-hardening-design.md`

**Interfaces:**
- Consumes: repository files and exported pure helpers added by later tasks.
- Produces: P1–P15 verification with a non-zero exit code on any failure.

- [ ] **Step 1: Write the failing Task 7 verification harness**

Use a table-driven harness with these exact scenario names:

```ts
const scenarios = [
  "P1 Required env validation",
  "P2 Production secret absence fails fast",
  "P3 Storage directory validation",
  "P4 Storage is private and non-public",
  "P5 Health liveness",
  "P6 Health readiness with database",
  "P7 Health response does not leak secrets",
  "P8 Query limits remain bounded",
  "P9 Production cookie and security config",
  "P10 Graceful shutdown closes the DB pool",
  "P11 Production migration is idempotent",
  "P12 Backup commands are syntactically valid",
  "P13 Rollback documentation exists",
  "P14 Production start command exists",
  "P15 Task 1–6 lifecycle remains unchanged",
] as const;

function assert(condition: boolean, code: string, description: string): void {
  total += 1;
  if (!condition) {
    failures += 1;
    console.error(`[FAIL] ${code}: ${description}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${code}: ${description}`);
}
```

P1–P14 must initially fail because their production artefacts do not exist or current fallbacks violate the contract. P15 reads the Task 6 report/test contract and must guard against modification of lifecycle source files outside the explicitly allowed infrastructure list.

- [ ] **Step 2: Run the dedicated suite and capture the intended RED state**

Run: `pnpm exec tsx scripts/test-production-readiness-task7.ts`

Expected: exit 1 with P1–P14 failures and a clear P15 result; failures must identify missing production contracts, not syntax/runtime errors in the harness.

- [ ] **Step 3: Make Task 4 SEC1 deterministic**

The current baseline failure has already proven the mtime-based assertion is unstable in a fresh worktree. Replace the five-minute mtime heuristic with a snapshot of filenames in `public/uploads/progress` captured before Task 4 creates progress evidence and compare it with the set after the suite. A newly created public file fails; copied/tracked files with refreshed mtimes do not. Run Task 4 immediately after the edit - without waiting - to prove 36/36 PASS.

- [ ] **Step 4: Commit the RED test and deterministic regression harness**

```powershell
git add scripts/test-production-readiness-task7.ts scripts/test-progress-task4.ts
git commit -m "test(task7): define readiness gates"
```

### Task 2: Add production environment validation and eliminate active secret fallbacks

**Files:**
- Create: `lib/runtime-config.ts`
- Modify: `lib/jwt.ts`
- Modify: `proxy.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Produces: `getRuntimeConfig(env?)`, `validateProductionConfig(env?)`, `getJwtSecret(env?)`, `RuntimeConfigError`.
- Consumes: `NodeJS.ProcessEnv` without logging its values.

- [ ] **Step 1: Add focused P1/P2 tests**

Test exact behavior:

```ts
assertThrows(
  () => validateProductionConfig({ NODE_ENV: "production" }),
  "DATABASE_URL",
  "P1"
);
assertThrows(
  () => getJwtSecret({ NODE_ENV: "production", JWT_SECRET: "short" }),
  "JWT_SECRET",
  "P2"
);
const secretSource = read("lib/jwt.ts") + read("proxy.ts") + read("lib/db.ts");
assert(!secretSource.includes("fallback_development_secret"), "P2", "no active fallback secret");
assert(!/postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/.test(secretSource), "P2", "no embedded DB credential");
```

Before defining required URLs, use `rg` to enumerate every read of `SPARTA_API_URL`, `SPARTA_LOGIN_URL`, and `NEXT_PUBLIC_APP_URL`, classify server/client/build-time usage, and record whether each enabled production path can safely start without it. Keep build stages secret-free and validate runtime configuration only from server startup/request code.

- [ ] **Step 2: Verify P1/P2 fail for the current source**

Run: `pnpm exec tsx scripts/test-production-readiness-task7.ts`

Expected: P1/P2 fail because the module and strict production contract do not exist and current secret fallbacks remain.

- [ ] **Step 3: Implement the typed configuration module**

Define exact production fields and bounded numbers:

```ts
export interface RuntimeConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  jwtSecret: string;
  workerSecret: string;
  appUrl: URL;
  spartaApiUrl: URL;
  spartaLoginUrl: URL;
  privateStorageRoot: string;
  dbPoolMax: number;
  dbConnectionTimeoutMs: number;
  dbIdleTimeoutMs: number;
  dbSslMode: "disable" | "require" | "verify-full";
  dbSslCa?: string;
}

export class RuntimeConfigError extends Error {
  readonly code = "INVALID_RUNTIME_CONFIG";
}
```

Production validation rules:

- `DATABASE_URL` is a valid `postgres:` or `postgresql:` URL.
- `JWT_SECRET` and `SPARTA_INTERNAL_WORKER_SECRET` are at least 32 characters.
- public application and upstream URLs parse as URLs; `NEXT_PUBLIC_APP_URL` is HTTPS in production.
- `PRIVATE_STORAGE_ROOT` is absolute in production.
- pool maximum is 1–50; timeouts are 1,000–120,000 ms.
- `DATABASE_SSL_MODE` accepts only `disable`, `require`, or `verify-full`; `verify-full` requires CA material.

Development defaults may use localhost and an explicit development-only secret, but only when `NODE_ENV !== "production"`.

- [ ] **Step 4: Route JWT use through the validated helper**

Replace module-level fallback constants in `lib/jwt.ts` and `proxy.ts` with `getJwtSecret()`. Preserve HS256, payload fields, and expiry behavior.

- [ ] **Step 5: Update `.env.example` and package runtime metadata**

Add safe placeholders for every production variable and descriptions for REQUIRED, OPTIONAL, DEVELOPMENT ONLY, and PRODUCTION ONLY fields. Add:

```json
"packageManager": "pnpm@11.28.3",
"engines": { "node": ">=24 <25", "pnpm": ">=11 <12" }
```

Use the locally installed pnpm version if it differs, and keep `tsx` in `devDependencies`.

- [ ] **Step 6: Run P1/P2 and typecheck**

Run:

```powershell
pnpm exec tsx scripts/test-production-readiness-task7.ts
pnpm run typecheck
```

Expected: P1/P2 pass; remaining Task 7 scenarios may still fail; typecheck exits 0.

- [ ] **Step 7: Commit environment hardening**

```powershell
git add lib/runtime-config.ts lib/jwt.ts proxy.ts .env.example package.json scripts/test-production-readiness-task7.ts
git commit -m "fix(config): enforce production secrets"
```

Include a commit body explaining that the removed database credential must be rotated because Git history retains it.

### Task 3: Harden the PostgreSQL pool, private storage, and process lifecycle

**Files:**
- Create: `lib/storage-config.ts`
- Create: `lib/process-lifecycle.ts`
- Modify: `lib/db.ts`
- Modify: `lib/progress-storage.ts`
- Modify: `lib/work-readiness-server.ts`
- Modify: `lib/server-daemon.ts`
- Modify: `instrumentation.ts`
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Produces: `getPrivateStoragePaths()`, `validatePrivateStorage()`, `getDbPool()`, `closeDbPool()`, `stopServerDaemon()`, `registerProcessLifecycle()`.
- Preserves: all current evidence lookup, traversal protection, watermarking, and lazy legacy migration behavior.

- [ ] **Step 1: Add failing P3/P4/P10 tests**

Test that a root resolving inside `public/` is rejected, a temporary private directory is created and write-probed, both evidence directories derive from one root, shutdown invokes injected daemon and pool close functions once, and source no longer owns unmanaged `setInterval`/`setTimeout` handles.

```ts
await assertRejects(
  () => validatePrivateStorage(path.join(process.cwd(), "public", "uploads")),
  "PRIVATE_STORAGE_PUBLIC",
  "P4"
);
const lifecycle = createProcessLifecycle({ stopDaemon, closePool, exit: recordExit });
await lifecycle.shutdown("SIGTERM");
await lifecycle.shutdown("SIGINT");
assert(stopDaemonCalls === 1 && closePoolCalls === 1, "P10", "shutdown is idempotent");
```

Inventory every filesystem write and persistent path using `rg` over `app`, `lib`, and `scripts`. Explicitly classify readiness, progress, final/completion/handover evidence, avatars, legacy public uploads, logs, temporary files, and test-only artefacts before finalizing the named-volume boundary.

- [ ] **Step 2: Verify P3/P4/P10 fail**

Run: `pnpm exec tsx scripts/test-production-readiness-task7.ts`

Expected: the three scenarios fail against hardcoded `process.cwd()/storage`, missing close logic, and unmanaged daemon timers.

- [ ] **Step 3: Implement storage configuration**

Resolve the root from runtime configuration, derive `readiness` and `progress`, reject roots equal to or nested beneath `public`, create directories recursively, and perform a randomized create/write/read/delete probe. Do not return absolute paths in thrown public messages.

- [ ] **Step 4: Harden the database pool**

Build pool options from `RuntimeConfig`, retain maximum 10 as the default, support verified TLS CA, avoid `rejectUnauthorized: false` for `verify-full`, and export:

```ts
export async function closeDbPool(): Promise<void> {
  const active = pool;
  pool = null;
  if (active) await active.end();
}
```

- [ ] **Step 5: Make the daemon stoppable**

Track both timer handles, prevent scheduling after stop, and export an async stop that clears pending timers and waits only up to the configured shutdown grace period for `isCycleRunning` to become false.

- [ ] **Step 6: Register lifecycle exactly once**

`instrumentation.ts` validates production configuration and storage before starting the daemon. `registerProcessLifecycle()` attaches `SIGTERM` and `SIGINT` once via a `globalThis` symbol and runs daemon stop then pool close. It must not echo secret or path values.

- [ ] **Step 7: Run P3/P4/P10 and typecheck**

Expected: P3, P4, and P10 pass; `pnpm run typecheck` exits 0.

- [ ] **Step 8: Commit lifecycle hardening**

```powershell
git add lib/storage-config.ts lib/process-lifecycle.ts lib/db.ts lib/progress-storage.ts lib/work-readiness-server.ts lib/server-daemon.ts instrumentation.ts scripts/test-production-readiness-task7.ts
git commit -m "fix(runtime): harden storage and shutdown"
```

### Task 4: Add safe liveness/readiness and HTTP production controls

**Files:**
- Create: `lib/health.ts`
- Create: `app/api/health/live/route.ts`
- Create: `app/api/health/ready/route.ts`
- Modify: `proxy.ts`
- Modify: `next.config.mjs`
- Modify: `app/api/notifications/logs/route.ts` only if bounds are not already testable/exported
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Produces: `createLivenessHandler()`, `createReadinessHandler(dependencies)`, exact public health paths.
- Readiness dependency contract: config validator, `SELECT 1` database probe, private storage validator.

- [ ] **Step 1: Add failing P5–P9 tests**

Invoke route factories directly with injected healthy and unhealthy dependencies. Assert:

```ts
assert(live.status === 200 && body.status === "live", "P5", "liveness is dependency-free");
assert(ready.status === 200 && readyBody.status === "ready", "P6", "readiness succeeds");
assert(unready.status === 503 && unreadyBody.status === "not_ready", "P6", "readiness fails closed");
assert(!JSON.stringify(unreadyBody).includes("postgres://"), "P7", "health does not leak secrets");
```

P8 checks notification limits clamp to 1–100, history limits remain 1–100, store search remains at most 100, and export remains at most 5000. P9 checks exact health-route exemption, security headers, production secure cookies, and API no-store configuration.

- [ ] **Step 2: Verify P5–P9 fail where controls are absent**

Run the Task 7 suite and confirm route/security failures are specific.

- [ ] **Step 3: Implement health services and routes**

Return only:

```ts
{ status: "live", timestamp: string }
{ status: "ready", checks: { config: "ok", database: "ok", storage: "ok" } }
{ status: "not_ready", checks: { config: "failed" | "ok", database: "failed" | "ok", storage: "failed" | "ok" } }
```

Set `Cache-Control: no-store`. Log sanitized internal errors server-side without response details.

- [ ] **Step 4: Harden proxy and headers**

Exempt only `/api/health/live` and `/api/health/ready`. Add repository-level response headers for `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and no-store on `/api/:path*`. Set `poweredByHeader: false` and `output: "standalone"`. Leave HSTS to Dokploy after HTTPS is active.

- [ ] **Step 5: Run P5–P9, typecheck, and focused notification tests**

Run:

```powershell
pnpm exec tsx scripts/test-production-readiness-task7.ts
pnpm exec tsx scripts/test-notification-branch-isolation.ts
pnpm run typecheck
```

Expected: P5–P9 pass, notification isolation remains 12/12, typecheck exits 0.

- [ ] **Step 6: Commit health and HTTP controls**

```powershell
git add lib/health.ts app/api/health proxy.ts next.config.mjs scripts/test-production-readiness-task7.ts
git commit -m "feat(health): add production probes"
```

### Task 5: Add ordered, locked, repeatable production migrations

**Files:**
- Create: `database/migrations/README.md`
- Create: `database/migrations/001_production_baseline.sql`
- Create: `scripts/migrate-production.mjs`
- Modify: `package.json`
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Produces: `pnpm run db:deploy` and a migration ledger named `sparta_schema_migrations`.
- Consumes: `DATABASE_URL` and database TLS environment without printing them.

- [ ] **Step 1: Add failing P11 migration-contract tests**

Assert the migration runner uses a stable advisory lock, creates the ledger, sorts migration filenames, calculates SHA-256 checksums, runs each pending SQL file in a transaction, records the checksum, rejects drift, and always releases the connection.

- [ ] **Step 2: Verify P11 fails**

Run Task 7 suite; expected P11 failure for missing runner and baseline.

- [ ] **Step 3: Build an additive baseline migration**

Extract the current production schema contract from existing setup/migration scripts and runtime ensure functions. Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS`. Preserve existing names, constraints, defaults, foreign keys, and data. Do not include `DROP`, `TRUNCATE`, destructive type conversion, seed data, or test records.

The baseline must cover existing tables used by incidents, users/permissions, notifications, earthquake events, estimations/routing/readiness, distributions, progress, and completion approvals.

- [ ] **Step 4: Implement the plain Node migration runner**

Use only runtime dependency `pg` plus Node built-ins so the production image does not require `tsx`. Required transaction shape:

```js
await client.query("BEGIN");
await client.query(sql);
await client.query(
  "INSERT INTO sparta_schema_migrations (name, checksum) VALUES ($1, $2)",
  [name, checksum]
);
await client.query("COMMIT");
```

On failure, rollback; on checksum mismatch, abort before executing; finally release advisory lock, client, and pool.

- [ ] **Step 5: Add production script**

```json
"db:deploy": "node scripts/migrate-production.mjs"
```

- [ ] **Step 6: Verify syntax and idempotency**

Run:

```powershell
node --check scripts/migrate-production.mjs
pnpm run db:deploy
pnpm run db:deploy
pnpm exec tsx scripts/test-production-readiness-task7.ts
```

Expected: both migration executions exit 0, the second applies zero migrations, and P11 passes. Do not run against a database unless `DATABASE_URL` identifies the existing authorized Task 1–6 development database.

- [ ] **Step 7: Commit migrations**

```powershell
git add database/migrations scripts/migrate-production.mjs package.json scripts/test-production-readiness-task7.ts
git commit -m "feat(db): add production migration runner"
```

### Task 6: Add Dokploy container deployment assets

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`
- Create: `compose.yaml`
- Modify: `package.json`
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Produces: `pnpm run start:production`, container port `3004`, volume `/app/storage`, and container healthcheck.

- [ ] **Step 1: Add failing P14 deployment-contract tests**

Assert a pinned Node 24 image, Corepack/frozen install, standalone runner, non-root user, `NODE_ENV=production`, port 3004, no secret build args or build-time secret requirements, named volume, `no-new-privileges`, healthcheck, and restart policy. Do not require `read_only: true`; document that it remains deferred until runtime temporary-write compatibility is proven.

- [ ] **Step 2: Verify P14 fails**

Run Task 7 suite; expected missing Docker/Compose/start contract failure.

- [ ] **Step 3: Create the multi-stage Dockerfile**

Stages: `base`, `deps`, `builder`, `runner`. Pin the Node 24 Bookworm slim image. Use Corepack and frozen lockfile. Run `pnpm run build`. Copy `.next/standalone`, `.next/static`, `public`, `database/migrations`, `scripts/migrate-production.mjs`, and package metadata. Create `/app/storage`, chown it to the non-root runtime user, then run `node server.js`.

- [ ] **Step 4: Create the Dokploy Compose contract**

The single app service must use:

```yaml
environment:
  NODE_ENV: production
  PORT: 3004
  HOSTNAME: 0.0.0.0
  PRIVATE_STORAGE_ROOT: /app/storage
volumes:
  - sparta_private_storage:/app/storage
restart: unless-stopped
security_opt:
  - no-new-privileges:true
```

Expose only port `3004` for Dokploy routing; do not publish PostgreSQL or hardcode a domain. Define `sparta_private_storage` as a named volume.

- [ ] **Step 5: Add start command and validate assets**

Add `"start:production": "node .next/standalone/server.js"`. Run:

```powershell
docker compose -f compose.yaml config
docker build -t sparta-siaga:task7 .
```

If Docker is unavailable, record this as an environment limitation and still run static/syntax verification.

- [ ] **Step 6: Run P14 and typecheck**

Expected: P14 passes and typecheck exits 0.

- [ ] **Step 7: Commit deployment assets**

```powershell
git add .dockerignore Dockerfile compose.yaml package.json scripts/test-production-readiness-task7.ts
git commit -m "build(dokploy): add production image"
```

### Task 7: Add backup/restore helpers and operational safeguards

**Files:**
- Create: `ops/backup-production.sh`
- Create: `ops/verify-backup.sh`
- Create: `ops/restore-production.sh`
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Backup output: matched timestamped database dump, evidence archive, SHA-256 manifest.
- Restore input: verified backup directory plus explicit `CONFIRM_RESTORE=YES` guard.
- Execution context: a Dokploy maintenance/sidecar job with PostgreSQL client tools, runtime-only database credentials, backup destination access, and the application evidence volume mounted read-only for backup/read-write for an approved restore.

- [ ] **Step 1: Add failing P12 tests**

Assert all scripts use `set -Eeuo pipefail`, quote paths, require commands, avoid printing `DATABASE_URL`, generate UTC timestamps, create checksums, verify `pg_restore --list`, include the complete persistent storage inventory under `/app/storage`, record the consistency window, require quiesced application writes, and require explicit restore confirmation.

- [ ] **Step 2: Verify P12 fails**

Run Task 7 suite; expected missing helper failures.

- [ ] **Step 3: Implement backup and verification scripts**

Backup contract (executed only after the app writer is stopped or placed in maintenance mode):

```sh
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom --file="$target/database.dump" "$DATABASE_URL"
tar -C "$PRIVATE_STORAGE_ROOT" -czf "$target/evidence.tar.gz" .
sha256sum "$target/database.dump" "$target/evidence.tar.gz" > "$target/SHA256SUMS"
pg_restore --list "$target/database.dump" >/dev/null
```

The implementation must mask command failures and never echo the connection string. Verification checks both artefacts and the manifest. The manifest records database dump completion and evidence archive start/end times; documentation states that this is a matched quiesced backup set, not an atomic cross-system snapshot.

- [ ] **Step 4: Implement guarded restore**

Require stopped application writes, a verified backup, an empty staging directory, and `CONFIRM_RESTORE=YES`. Restore database and evidence only in the documented order. Do not run this script during Task 7 verification.

- [ ] **Step 5: Run shell syntax/static checks and P12**

Run `bash -n` when Bash is available; otherwise use the dedicated static assertions and record the environment limitation. Expected: P12 passes.

- [ ] **Step 6: Commit operational helpers**

```powershell
git add ops scripts/test-production-readiness-task7.ts
git commit -m "feat(ops): add backup restore tooling"
```

### Task 8: Write Dokploy operations documentation and risk register

**Files:**
- Create: `docs/05-production/TASK_7_PRODUCTION_READINESS_CHECKLIST.md`
- Create: `docs/05-production/DOKPLOY_DEPLOYMENT_GUIDE.md`
- Create: `docs/05-production/ENVIRONMENT_REQUIREMENTS.md`
- Create: `docs/05-production/BACKUP_AND_RESTORE.md`
- Create: `docs/05-production/ROLLBACK_PROCEDURE.md`
- Create: `docs/05-production/INFRASTRUCTURE_RISK_LIST.md`
- Test: `scripts/test-production-readiness-task7.ts`

**Interfaces:**
- Produces: operator-ready deployment, backup, restore, rollback, permission, and risk procedures.

- [ ] **Step 1: Add failing P13 and documentation coverage tests**

Assert every required file exists and contains exact sections for prerequisites, commands, validation, failure behavior, ownership, and rollback limitations. Assert the risk list separates APPLICATION BLOCKER, ENVIRONMENT BLOCKER, and RECOMMENDATION.

- [ ] **Step 2: Verify documentation scenarios fail**

Run Task 7 suite; expected P13/document coverage failure.

- [ ] **Step 3: Write environment and deployment guides**

Document Node 24, pnpm 11, PostgreSQL support baseline, Linux/Docker assumptions, writable named volume, Asia/Jakarta timezone, Dokploy environment entry, Compose deployment, domain-to-port-3004 mapping, Traefik TLS/redirect/HSTS, upload limit, request timeout, readiness checks, migration-before-start, smoke checks, and exact rollback trigger.

- [ ] **Step 4: Write backup, restore, and rollback guides**

Define daily/weekly/monthly retention recommendations, off-host S3 destination, matched database/evidence set, verification cadence, quarterly restore rehearsal, destructive restore approval, evidence consistency limitation, previous-image compatibility check, and configuration rollback.

- [ ] **Step 5: Write checklist and risk register**

Track all 16 required readiness categories. Record credential rotation, real Dokploy access, DNS/TLS, external PostgreSQL backup policy, S3 destination, firewall/network policy, and public legacy upload disposition with explicit owner and deployment impact.

- [ ] **Step 6: Run P13 and documentation tests**

Expected: P13 and documentation coverage pass.

- [ ] **Step 7: Commit documentation**

```powershell
git add docs/05-production scripts/test-production-readiness-task7.ts
git commit -m "docs(ops): add Dokploy runbooks"
```

### Task 9: Prove lifecycle preservation and complete verification

**Files:**
- Modify: `scripts/test-production-readiness-task7.ts`
- Create: `docs/03-qa-and-testing/TASK_7_PRODUCTION_HARDENING_REPORT.md`

**Interfaces:**
- Produces: final P1–P15 evidence and Task 7 report.

- [ ] **Step 1: Complete P15 regression guard**

P15 must run or validate the established Task 1–6 test commands and confirm no infrastructure change grants an operational permission or modifies lifecycle transitions.

- [ ] **Step 2: Run the dedicated Task 7 suite**

Run: `pnpm exec tsx scripts/test-production-readiness-task7.ts`

Expected: P1–P15 all PASS, exit 0.

- [ ] **Step 3: Run the complete Task 1–6 regression suite**

Run each command independently and record exact counts:

```powershell
pnpm exec tsx scripts/test-lifecycle-task1.ts
pnpm exec tsx scripts/test-estimation-flow-task2.ts
pnpm exec tsx scripts/test-work-readiness-task3.ts
pnpm exec tsx scripts/test-readiness-security-patch.ts
pnpm exec tsx scripts/test-progress-task4.ts
pnpm exec tsx scripts/test-progress-permission-patch.ts
pnpm exec tsx scripts/test-estimation-progress-flow.ts
pnpm exec tsx scripts/test-completion-approval-task5.ts
pnpm exec tsx scripts/test-final-integration-task6.ts
pnpm exec tsx scripts/test-notification-branch-isolation.ts
```

Expected: all established tests PASS with zero failures.

- [ ] **Step 4: Run install, lint, typecheck, and build gates**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run build
```

Expected: every command exits 0. Report warnings separately from failures.

- [ ] **Step 5: Verify Docker/Compose and deployment artefacts**

Run Compose config, image build, container liveness/readiness, non-root identity, storage write persistence across container recreation, and graceful `docker stop` when Docker is available. Do not claim live Dokploy deployment without authenticated dashboard access.

- [ ] **Step 6: Audit the final diff and secrets**

Run:

```powershell
git diff --check 46952b8..HEAD
git diff --name-status 46952b8..HEAD
rg -l --hidden -g '!node_modules/**' -g '!.next/**' -g '!.git/**' -g '!.superpowers/**' 'postgres(ql)?://[^[:space:]"'']+:[^[:space:]"'']+@|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*["''][^"'']{12,}["'']' .
git diff 46952b8..HEAD -- . ':(exclude)pnpm-lock.yaml'
git status --short
```

Review every match manually: only documented placeholders or clearly synthetic test fixtures are allowed. Also inspect Docker build arguments/environment, committed private-key extensions, `.env*` tracking, and all changed files since `46952b8`; ensure no Task 8 work or business-flow change slipped in.

- [ ] **Step 7: Write the final Task 7 report**

Include every item required by the request: executive summary, before state, file changes, environment and secret audit, DB/migration, backup/restore, storage, permissions, health, error handling, HTTPS/reverse proxy, session security, deployment/startup/shutdown/rollback, security findings, P1–P15 results, regression totals, install/lint/typecheck/build, warnings, infrastructure risks, deferrals, assumptions, recommendation, all checklist statuses, production readiness, and safe-to-continue decisions.

- [ ] **Step 8: Run final evidence commands again after report edits**

Freshly rerun Task 7 tests, full regression, lint, typecheck, and build. Update the report only with these final results.

- [ ] **Step 9: Commit final verification**

```powershell
git add scripts/test-production-readiness-task7.ts docs/03-qa-and-testing/TASK_7_PRODUCTION_HARDENING_REPORT.md
git commit -m "test(task7): verify production readiness"
```

Stop after presenting the Task 7 report. Do not start Task 8.
