# SPARTA SIAGA - Infrastructure & Production Risk Register

This document records the identified infrastructure, environment, and operational risks for SPARTA SIAGA, categorizing them by blocker level and assigning explicit owners and mitigation plans.

---

## 1. APPLICATION BLOCKER

*Issues that must be resolved directly within the application codebase or build assets before deployment.*

### RISK-01: Removed Database Credential Remains in Git History
- **Category**: APPLICATION BLOCKER
- **Description**: An active PostgreSQL connection string containing credentials was previously present in `lib/db.ts` and committed in earlier Git commits. Although removed from active code during Task 2, Git history retains the credential string.
- **Owner**: Database Administrator / Security Engineer
- **Deployment Impact**: HIGH. The exposed database user account must be rotated or regenerated at the provider (Aiven Cloud) before production launch.
- **Mitigation**:
  1. Provision a new dedicated database user with a strong random password in Aiven Console.
  2. Update `DATABASE_URL` in Dokploy environment variables with the new credentials.
  3. Revoke/delete the compromised database user.

---

## 2. ENVIRONMENT BLOCKER

*Prerequisites that must be configured in the host environment or external services before deployment can succeed.*

### RISK-02: Dokploy Host & Dashboard Authentication
- **Category**: ENVIRONMENT BLOCKER
- **Description**: Dokploy server instance, administrative accounts, and 2FA must be active to allow application and container deployment.
- **Owner**: DevOps / Infrastructure Team
- **Deployment Impact**: CRITICAL. Without Dokploy access, deployment cannot proceed.
- **Mitigation**: Verify host access, set up Dokploy project space, and configure restricted access permissions for release operators.

### RISK-03: DNS Mapping & Traefik TLS Issuance
- **Category**: ENVIRONMENT BLOCKER
- **Description**: Production domain (e.g. `siaga.sparta.internal` or corporate domain) must route to Dokploy's public IP, and Traefik Let's Encrypt / corporate TLS certificate generation must be valid.
- **Owner**: Network / DNS Administrator
- **Deployment Impact**: HIGH. Without valid HTTPS, browsers will reject secure cookies (`secure: true`) and block service workers/PWA push notifications.
- **Mitigation**: Configure DNS A record prior to cutover; verify HTTP-01 or DNS-01 ACME challenge resolution in Traefik.

### RISK-04: Network Egress to Public Disaster Feeds
- **Category**: ENVIRONMENT BLOCKER
- **Description**: The autonomous server daemon polls BMKG (`data.bmkg.go.id`), USGS (`earthquake.usgs.gov`), and Open-Meteo (`api.open-meteo.com`). If the Dokploy server blocks outbound traffic via strict firewall egress, disaster monitoring will fail.
- **Owner**: Network Security / Firewall Team
- **Deployment Impact**: HIGH. Disaster detection will default to manual reporting only.
- **Mitigation**: Whitelist outbound TCP port 443 to the required feed domains in host security groups / corporate firewall.

---

## 3. RECOMMENDATIONS

*Operational improvements and secondary hardening measures that do not block initial deployment.*

### RISK-05: Off-Host S3 Backup Replication
- **Category**: RECOMMENDATION
- **Description**: Backup scripts currently store matched database and evidence files on the local filesystem (`/backups`). If host disk hardware fails, local backups could be lost.
- **Owner**: DevOps / Storage Administrator
- **Deployment Impact**: MEDIUM.
- **Mitigation**: Configure automated daily sync of `/backups` to an encrypted off-host S3/MinIO bucket.

### RISK-06: External PostgreSQL Point-in-Time Recovery (PITR)
- **Category**: RECOMMENDATION
- **Description**: Relying exclusively on manual daily `pg_dump` dumps gives a Recovery Point Objective (RPO) of up to 24 hours.
- **Owner**: Database Administrator
- **Deployment Impact**: LOW.
- **Mitigation**: Enable automated continuous WAL archiving and Point-in-Time Recovery on the managed PostgreSQL provider (Aiven Cloud).

### RISK-07: Avatar Uploads Transition to S3 / Corporate Media Service
- **Category**: RECOMMENDATION
- **Description**: User profile avatars are currently written to `public/uploads/avatars`. Although non-critical, in multi-instance horizontally scaled deployments, local public files are not shared across container replicas.
- **Owner**: Application Developer
- **Deployment Impact**: LOW.
- **Mitigation**: Transition avatar uploads to S3/MinIO or corporate media storage in a future phase.

### RISK-08: Container Read-Only Root Filesystem Compatibility
- **Category**: RECOMMENDATION
- **Description**: `compose.yaml` does not enforce `read_only: true` because Next.js and native image libraries (Sharp/Leaflet) may require temporary cache writes to `/tmp`.
- **Owner**: DevOps / Application Developer
- **Deployment Impact**: LOW.
- **Mitigation**: Evaluate tmpfs mounts (`/tmp`, `/app/.next/cache`) in a staging trial before enabling read-only root in production.

### RISK-09: Legacy Public Uploads Purge Cadence
- **Category**: RECOMMENDATION
- **Description**: Legacy uploads automatically migrate to private storage upon first access and are unlinked from `public/`. A scheduled batch job should sweep any remaining dormant legacy files.
- **Owner**: Application Developer
- **Deployment Impact**: LOW.
- **Mitigation**: Run a one-time migration sweep script to ensure all historical progress evidence is moved into `/app/storage`.
