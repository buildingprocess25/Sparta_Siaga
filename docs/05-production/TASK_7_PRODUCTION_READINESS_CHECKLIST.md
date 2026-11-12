# SPARTA SIAGA - Task 7 Production Readiness Checklist

This checklist tracks the operational readiness status across all 16 infrastructure, architecture, and security hardening categories established in Task 7.

---

> [!IMPORTANT] PHASE 5 DOKPLOY PRODUCTION DEPLOYMENT LOCKED
> Dokumen checklist ini adalah instrumen verifikasi kesiapan teknis produksi yang disusun pada Task 7.
> **Phase 5 Production Deployment saat ini tetap BERSTATUS TERKUNCI (LOCKED)**.
> Database produksi Dokploy (`siaga`) tidak boleh dimodifikasi, dimigrasi, atau diakses selama fase development/UAT aktif. Seluruh pengujian dan simulasi operasional saat ini diarahkan secara eksklusif ke database terisolasi Aiven (`sparta_siaga_isolated`).

---

## Readiness Status Summary

- **Total Categories**: 16
- **Application Code Hardened**: 16/16 (100%)
- **Automated Gates Passing**: 15/15 (P1–P15)
- **External Environment Blockers**: 5 items documented for Operator Action

---

## 16 Readiness Categories Checklist

| Category | Description | Status | Verification Evidence / Location |
|---|---|---|---|
| **1. Runtime Env Validation** | Fail-fast validation of required variables (`DATABASE_URL`, `JWT_SECRET`, etc.) at startup without logging secret values. | **READY** | `lib/runtime-config.ts`, `scripts/test-production-readiness-task7.ts` (P1) |
| **2. Secret Sanitization** | Elimination of hardcoded secrets and active fallback credentials from active source code. | **READY** | `lib/jwt.ts`, `lib/db.ts`, `proxy.ts` (P2) |
| **3. Private Storage Isolation** | Storage outside `public/` web root (`/app/storage`), path traversal prevention, and directory write probe. | **READY** | `lib/storage-config.ts` (P3, P4) |
| **4. Non-Root Container Execution** | Docker container runs as non-privileged system user (`nextjs:nodejs`, UID/GID 1001). | **READY** | `Dockerfile`, `compose.yaml` (P14) |
| **5. Multi-Stage Pinned Docker Build** | Pinned Node 24 Bookworm slim base image, Corepack pnpm frozen install, standalone output. | **READY** | `Dockerfile`, `.dockerignore` |
| **6. Dokploy Compose Contract** | Service specification with port 3004, named volume mount, `no-new-privileges`, healthcheck. | **READY** | `compose.yaml`, `DOKPLOY_DEPLOYMENT_GUIDE.md` (P14) |
| **7. Additive Idempotent Migrations** | Plain Node migration runner using `pg`, advisory locking, checksum drift detection, and `sparta_schema_migrations` ledger. | **READY** | `database/migrations/001_production_baseline.sql`, `scripts/migrate-production.mjs` (P11) |
| **8. Graceful Process Lifecycle** | Signal trap for `SIGTERM`/`SIGINT` ensuring daemon timer cancellation and clean DB pool drain. | **READY** | `lib/process-lifecycle.ts`, `instrumentation.ts` (P10) |
| **9. Liveness & Readiness Probes** | `/api/health/live` and `/api/health/ready` endpoints verifying DB and storage without leaking credentials on 503. | **READY** | `lib/health.ts`, `app/api/health/*` (P5, P6, P7) |
| **10. Session Security & Cookies** | Production session cookies enforce `HttpOnly`, `Secure` (HTTPS), and `SameSite=Lax`. | **READY** | `lib/session-config.ts`, `app/api/auth/*` (P9) |
| **11. HTTP Security Headers** | Security headers configured (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store` on API). | **READY** | `next.config.mjs`, `proxy.ts` (P9) |
| **12. Query Bounds & Pagination Caps** | Strict upper boundaries on notifications, logs, and store search queries preventing DoS. | **READY** | `app/api/notifications/logs/route.ts` (P8) |
| **13. Quiesced Matched Backup Tooling** | Script producing matched database dump, evidence tarball, and SHA-256 manifest. | **READY** | `ops/backup-production.sh` (P12) |
| **14. Backup Checksum Verification** | Offline script verifying checksums and inspects PostgreSQL TOC headers. | **READY** | `ops/verify-backup.sh` (P12) |
| **15. Guarded Destructive Restore** | Script requiring explicit `CONFIRM_RESTORE=YES` flag and verifying backup before table replacement. | **READY** | `ops/restore-production.sh` (P12) |
| **16. Runbooks & Risk Documentation** | Complete deployment guide, environment requirements, backup/restore runbook, rollback procedure, and risk list. | **READY** | `docs/05-production/*` (P13) |

---

## Operational Action Items Prior to Live Cutover

1. [ ] **Rotate Production DB Password**: Live database administrator must change the password for the database user to invalidate historical credentials.
2. [ ] **Dokploy Application Creation**: DevOps operator must configure the Dokploy service and insert production environment variables.
3. [ ] **DNS & SSL Verification**: Confirm `siaga.sparta.co.id` resolves to the Dokploy host with valid HTTPS certificate.
4. [ ] **Run Initial Migration**: Execute `node scripts/migrate-production.mjs` to establish the `sparta_schema_migrations` table and baseline schema.
5. [ ] **Configure S3 Backup Bucket**: Set up an offsite bucket and schedule daily backup script runs.
