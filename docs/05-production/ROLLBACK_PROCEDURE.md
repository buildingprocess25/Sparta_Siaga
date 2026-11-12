# SPARTA SIAGA - Production Rollback Procedure

This runbook defines the criteria, steps, and validation checks for safely executing a rollback in production.

---

## 1. Rollback Trigger Criteria

Initiate a rollback immediately if any of the following conditions occur post-deployment:
- **P0 Severity**: Container fails to start, exits repeatedly (CrashLoopBackOff), or liveness/readiness probes persistently fail.
- **Data Integrity Risk**: Unhandled database deadlocks, connection pool exhaustion, or serialization failures.
- **Security Vulnerability**: Critical regression in authentication, authorization bypass, or unintended secret disclosure.
- **Workflow Blocker**: Duty officers or field technicians cannot submit incidents, verify status, upload progress photos, or approve handovers.

---

## 2. Prerequisites

Before initiating a rollback:
1. **Identify the Last Known Good State**: Locate the previous stable image tag (e.g., `sparta-siaga:v1.2.0` or git SHA).
2. **Access Required**: Access to the Dokploy control panel or host shell with Docker Compose permissions.
3. **Capture Diagnostic Artifacts**: Save logs from the failing container for post-mortem analysis:
   ```bash
   docker logs --tail 500 sparta-siaga-app > /var/log/sparta_incident_$(date +%s).log
   ```
4. **Quiesce Writes if Data Corruption Suspected**: Stop the container before attempting any database operations.

---

## 3. Rollback Procedures

### Scenario A: Fast Application Image Rollback (Standard Code Regression)

Because SPARTA SIAGA database migrations are **strictly additive** (new columns and tables only, never dropping or altering existing columns destructively), previous container versions remain backward-compatible with the migrated schema.

```bash
# 1. In Dokploy, update the deployment image tag to the previous known good version:
# Example in compose.yaml:
# image: sparta-siaga:previous_release_tag

# 2. Redeploy the service
docker compose -f compose.yaml up -d --no-deps app

# 3. Verify container starts cleanly
docker compose -f compose.yaml ps
```

### Scenario B: Configuration & Secret Rollback

If the regression was caused by invalid environment variables (e.g., misconfigured `DATABASE_URL`, weak `JWT_SECRET`, or missing CA cert):

1. Open Dokploy **Environment** settings.
2. Revert the erroneous variable to its previous validated value.
3. Restart the service to apply changes:
   ```bash
   docker compose -f compose.yaml restart app
   ```

### Scenario C: Catastrophic Database Corruption Rollback

If data corruption has occurred requiring a complete restore to pre-deployment state:

1. Stop all application traffic:
   ```bash
   docker compose -f compose.yaml stop app
   ```
2. Locate the pre-deployment backup package.
3. Run the guarded restore script:
   ```bash
   CONFIRM_RESTORE=YES \
   DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>:5432/<DB_NAME>" \
   PRIVATE_STORAGE_ROOT="/app/storage" \
   bash ops/restore-production.sh /backups/sparta_backup_PRE_DEPLOY
   ```
4. Start the previous known-good application version:
   ```bash
   docker compose -f compose.yaml up -d
   ```

---

## 4. Post-Rollback Validation

Verify system stability immediately following the rollback:

1. **Check Probes**:
   ```bash
   curl -i http://localhost:3004/api/health/live
   curl -i http://localhost:3004/api/health/ready
   ```
   Both endpoints must return HTTP 200.
2. **Check Container Logs**:
   ```bash
   docker compose -f compose.yaml logs --tail 100 app
   ```
   Confirm no unhandled configuration errors, DB connection timeouts, or fatal process crashes.
3. **User Authentication & Permission Validation**:
   - Log in as Duty Officer and Branch Manager.
   - Confirm session cookies and permissions are evaluated without errors.
4. **End-to-End Workflow Validation**:
   - Verify disaster reports are viewable.
   - Confirm active incident progress history is intact.

---

## 5. Rollback Limitations & Non-Goals

- **No Automatic Schema Downgrade**: Automated down migrations are not supported. Since all migrations are additive (`IF NOT EXISTS`), schema changes do not break older code versions.
- **Data Loss on Restoration**: Restoring from a backup package reverts the database to the backup timestamp. Any valid transactions created between the backup and the rollback will be lost.
