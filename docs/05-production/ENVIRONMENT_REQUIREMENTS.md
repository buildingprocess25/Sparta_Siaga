# SPARTA SIAGA - Environment & Infrastructure Requirements

This document details the environment specifications, secrets, system resources, and upstream services required to run SPARTA SIAGA in production.

---

## 1. System Requirements

### Hardware / Resource Recommendations
- **CPU**: 2 vCPU minimum (4 vCPU recommended for concurrent Leaflet GIS requests).
- **RAM**: 2 GB minimum (4 GB recommended for raster photo watermarking and in-memory spatial clustering).
- **Disk Storage**:
  - Application Image: ~250 MB.
  - Persistent Volume (`/app/storage`): 20 GB+ SSD recommended depending on photo evidence retention period.

### Operating System & Container Engine
- **Host OS**: Linux (Ubuntu 22.04 LTS / Debian 12 / AlmaLinux 9 or similar modern Linux kernel).
- **Container Runtime**: Docker Engine 24+ with Docker Compose v2.
- **Dokploy Version**: Dokploy v0.8+ with Traefik ingress controller.

---

## 2. Database Prerequisites

- **Database Engine**: PostgreSQL 14, 15, or 16 (e.g. Aiven Cloud, AWS RDS, GCP Cloud SQL).
- **Database Extensions**:
  - `pgcrypto` (or built-in `gen_random_uuid()`) for UUID generation in distribution tables.
- **Connectivity**:
  - Accessible via TCP port 5432 (or provider custom port) from Dokploy host.
  - TLS encryption enabled (`sslmode=require` or higher).
- **User Permissions**:
  - `CONNECT`, `CREATE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` on the application database.
  - Permission to acquire session advisory locks (`pg_advisory_lock`).

---

## 3. Environment Variables Reference

### Critical Runtime Secrets (REQUIRED)

| Variable | Min Length | Description | Classification |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | - | PostgreSQL connection URL with user, password, host, port, db | Runtime Secret |
| `JWT_SECRET` | 32 chars | HMAC key for signing and verifying session JWTs | Runtime Secret |
| `SPARTA_INTERNAL_WORKER_SECRET` | 32 chars | Bearer secret for automated disaster worker endpoints | Runtime Secret |
| `PRIVATE_STORAGE_ROOT` | - | Absolute path to persistent storage volume (e.g. `/app/storage`) | Runtime Config |

> [!CAUTION]
> Secrets must NEVER be supplied as Docker build arguments (`ARG`), committed to version control, or printed to application logs.

### Application Infrastructure Settings (OPTIONAL)

| Variable | Default | Allowed Range | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `production` | `production`, `development`, `test` | Target execution environment |
| `PORT` | `3004` | 1–65535 | HTTP listener port |
| `HOSTNAME` | `0.0.0.0` | IP string | Network interface binding |
| `DATABASE_POOL_MAX` | `10` | 1–50 | Maximum pool client connections |
| `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` | 1000–120000 | Connection timeout in milliseconds |
| `DATABASE_IDLE_TIMEOUT_MS` | `30000` | 1000–120000 | Client idle timeout before reaping |
| `DATABASE_SSL_MODE` | `require` | `disable`, `require`, `verify-full` | Database TLS mode |
| `DATABASE_SSL_CA_BASE64` | `""` | Base64 string | Required only if `verify-full` mode is used |
| `TZ` | `Asia/Jakarta` | Timezone string | Server timezone (WIB) |

### Upstream Integrations (OPTIONAL)

| Variable | Description |
| :--- | :--- |
| `APP_BASE_URL` | Public HTTPS URL for email links and redirection |
| `SPARTA_API_URL` | Corporate SPARTA Backend for SSO token exchange |
| `SPARTA_LOGIN_URL` | Corporate SSO login portal URL |

---

## 4. Upstream Network Egress Requirements

The server container requires outbound HTTPS access (port 443) to:
1. **BMKG Public API** (`data.bmkg.go.id`): Live earthquake feeds.
2. **USGS Earthquake Hazards Program** (`earthquake.usgs.gov`): International earthquake validation.
3. **Open-Meteo Weather API** (`api.open-meteo.com`): Multi-coordinate branch rainfall forecasts.
4. **Corporate SPARTA API** (if SSO integration enabled): Launch token exchange.
