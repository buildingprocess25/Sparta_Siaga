# SPARTA SIAGA - Backup & Restore Operations Runbook

This document describes the backup architecture, retention schedule, operational scripts, and recovery procedures for SPARTA SIAGA in production.

---

## 1. Backup Architecture & Consistency Model

SPARTA SIAGA data consists of two distinct components that must remain strictly synchronized:
1. **Relational Database**: PostgreSQL tables storing incident states, estimations, approvals, users, and audit logs.
2. **Persistent Storage**: Binary evidence photos, documents, and watermarked attachments stored in the persistent volume at `/app/storage`.

### The Quiescence Contract
Because PostgreSQL and local filesystem storage do not share an atomic two-phase commit snapshot mechanism, **application writes must be quiesced or container execution stopped** during backup generation.

This guarantees that:
- Every image path recorded in the database exists in the evidence archive.
- Every uploaded evidence file corresponds to a committed database record.
- No partially written image uploads or in-flight database transactions exist in the backup.

---

## 2. Retention Schedule & Storage Tiers

| Tier | Frequency | Retention Period | Storage Destination |
|---|---|---|---|
| **Daily** | Once per day (02:00 WIB) | 7 days | Local backup volume + Offsite S3 Bucket |
| **Weekly** | Every Sunday night | 4 weeks | Offsite S3 Bucket |
| **Monthly** | 1st day of month | 12 months | Offsite S3 Glacier / Deep Archive |

---

## 3. Backup Package Structure

Each backup run produces a timestamped directory containing:
```
sparta_backup_YYYYMMDDTHHMMSSZ/
├── database.dump           # PostgreSQL custom-format binary dump (pg_dump -Fc)
├── evidence.tar.gz         # Gzip-compressed archive of /app/storage
├── SHA256SUMS              # Cryptographic manifest of files and hashes
└── backup_metadata.json    # JSON metadata (timing, parameters, consistency flag)
```

---

## 4. Operational Backup Procedure

### Automated / Maintenance Container Execution
Run the backup script inside a maintenance container with access to PostgreSQL client tools and the mounted persistent storage volume:

```bash
# 1. Quiesce application (stop incoming writes)
docker compose -f compose.yaml pause app
# OR scale down / stop app service during maintenance window:
# docker compose -f compose.yaml stop app

# 2. Execute backup
export DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DB_NAME>"
export PRIVATE_STORAGE_ROOT="/app/storage"
export BACKUP_DIR="/backups"

bash ops/backup-production.sh

# 3. Resume application
docker compose -f compose.yaml unpause app
# OR docker compose -f compose.yaml start app
```

### Offsite Replication to S3
Sync the resulting backup directory to your organization's encrypted S3 bucket:

```bash
aws s3 sync /backups/sparta_backup_20261007T020000Z/ \
  s3://sparta-siaga-backups-prod/20261007T020000Z/ \
  --sse aws:kms
```

---

## 5. Backup Verification Procedure

Verification tests the integrity of both artifacts and checksum manifests without writing to the database:

```bash
bash ops/verify-backup.sh /backups/sparta_backup_20261007T020000Z
```

The script performs three checks:
1. `sha256sum -c SHA256SUMS`: Verifies bitwise integrity against the recorded manifest.
2. `pg_restore --list database.dump`: Inspects PostgreSQL binary table-of-contents headers.
3. `tar -tzf evidence.tar.gz`: Verifies gzip block decompression and file header validity.

---

## 6. Guarded Restoration Procedure

> [!CAUTION]
> **RESTORATION IS DESTRUCTIVE.**
> Restoring a backup overwrites existing PostgreSQL tables and replaces files in `/app/storage`.

### Prerequisites for Restoration
1. Application traffic must be halted.
2. Verified backup directory available locally.
3. Explicit environment flag `CONFIRM_RESTORE=YES`.

### Execution
```bash
# 1. Stop application containers to prevent concurrent writes
docker compose -f compose.yaml stop app

# 2. Execute guarded restore
CONFIRM_RESTORE=YES \
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DB_NAME>" \
PRIVATE_STORAGE_ROOT="/app/storage" \
bash ops/restore-production.sh /backups/sparta_backup_20261007T020000Z

# 3. Restart application
docker compose -f compose.yaml start app

# 4. Check readiness probe
curl -f http://localhost:3004/api/health/ready
```

---

## 7. Disaster Recovery Rehearsal Cadence

- **Quarterly Drill**: Conduct a scheduled non-production restore test every 3 months.
- **Objectives**: Validate RTO (Recovery Time Objective < 30 minutes) and RPO (Recovery Point Objective < 24 hours).
