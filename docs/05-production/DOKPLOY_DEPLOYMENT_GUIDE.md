# SPARTA SIAGA - Dokploy Deployment Guide

This guide provides end-to-end instructions for deploying, configuring, and maintaining SPARTA SIAGA on Dokploy.

---

## 1. Overview & Deployment Architecture

SPARTA SIAGA is deployed to Dokploy as a containerized Next.js 16 application running in standalone mode behind Dokploy's automated Traefik reverse proxy.

```
                    Internet
                       │
             HTTPS (Port 443) / HTTP (Port 80)
                       ▼
              [Dokploy / Traefik]
          (TLS Termination & HSTS)
                       │
             HTTP (Port 3004)
                       ▼
         [sparta-siaga-app Container]
            (Node.js 24 Standalone)
           ┌───────────┴───────────┐
           ▼                       ▼
    [Named Volume]        [External Database]
  /app/storage (SSD)       PostgreSQL (TLS)
```

---

## 2. Dokploy Application Setup

### Step 2.1: Create Project & Application
1. Log in to your Dokploy control panel.
2. Select your target Project or create a new one named `sparta-siaga`.
3. Click **Create Service** and choose **Compose** (or **Application** pointing to Dockerfile).
4. Set Service Name: `sparta-siaga-app`.

### Step 2.2: Git Repository Connection
1. Select Git Provider (GitHub / GitLab / Git Repository).
2. Repository URL: Point to the SPARTA SIAGA repository.
3. Branch: Select `main` (or designated production release branch).
4. Build Type: **Docker Compose** using `compose.yaml` (or Dockerfile).

### Step 2.3: Persistent Volume Mount
Ensure the named volume is configured in Dokploy:
- **Volume Name**: `sparta_private_storage`
- **Mount Path**: `/app/storage`
- **Access**: Read-Write

---

## 3. Environment Variables Configuration

In the Dokploy **Environment** tab for the service, configure all mandatory variables. Do NOT commit production values to source control.

```env
NODE_ENV=production
PORT=3004
HOSTNAME=0.0.0.0
PRIVATE_STORAGE_ROOT=/app/storage
TZ=Asia/Jakarta

# Database connection to managed PostgreSQL instance
DATABASE_URL=postgresql://<DB_USER>:<SECURE_PASSWORD>@<DB_HOST>:5432/<DB_NAME>?sslmode=require
DATABASE_SSL_MODE=require

# Application Secrets (Must be at least 32 characters)
JWT_SECRET=<STRONG_RANDOM_JWT_SECRET_MIN_32_CHARS>
SPARTA_INTERNAL_WORKER_SECRET=<STRONG_RANDOM_WORKER_SECRET_MIN_32_CHARS>

# Domain & URL settings (HTTPS mandatory in production)
NEXT_PUBLIC_APP_URL=https://siaga.sparta.co.id
APP_BASE_URL=https://siaga.sparta.co.id

# Optional upstream integration URLs (if enabled)
SPARTA_API_URL=https://api.sparta.co.id
SPARTA_LOGIN_URL=https://login.sparta.co.id
```

---

## 4. Traefik Reverse Proxy & Domain Settings

In Dokploy's **Domains** tab:
1. **Host**: Enter production domain (e.g., `siaga.sparta.co.id`).
2. **Port**: Set container internal port to `3004`.
3. **HTTPS / SSL**: Enable **Let's Encrypt** (or upload custom corporate wildcard SSL certificate).
4. **Redirect HTTP to HTTPS**: Enabled.
5. **Middlewares / Headers**:
   - `client_max_body_size`: Set to `50M` (to allow high-resolution incident and progress photos).
   - `proxy_read_timeout`: Set to `120s`.
   - `Strict-Transport-Security` (HSTS): Enabled with `max-age=31536000; includeSubDomains`.

---

## 5. Pre-Deployment Database Migration

Before directing live user traffic to a new deployment, run database migrations. Migrations in SPARTA SIAGA are strictly additive and idempotent.

### Running Migrations via Dokploy Terminal / CLI
Execute the migration runner inside the deployment container:

```bash
docker exec -it sparta-siaga-app node scripts/migrate-production.mjs
```

Or run via automated Dokploy Pre-Deploy / Deploy Command:
```bash
node scripts/migrate-production.mjs
```

The runner:
1. Acquires a PostgreSQL advisory lock (`pg_advisory_lock(7421839)`).
2. Verifies existing checksums against `sparta_schema_migrations`.
3. Executes pending `.sql` migration files within atomic transactions.
4. Releases the lock upon completion.

---

## 6. Health Probes & Monitoring

SPARTA SIAGA provides two dedicated health endpoints exempted from authentication:

1. **Liveness Probe** (`GET /api/health/live`):
   - Fast lightweight check that the Node HTTP process is alive.
   - Returns HTTP 200 with `{"status": "live", "timestamp": "..."}`.
   - Dokploy container healthcheck configuration:
     ```yaml
     test: ["CMD", "node", "-e", "fetch('http://localhost:3004/api/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
     interval: 30s
     timeout: 5s
     retries: 3
     start_period: 15s
     ```

2. **Readiness Probe** (`GET /api/health/ready`):
   - Comprehensive dependency probe verifying runtime config, PostgreSQL `SELECT 1`, and storage root read/write capability.
   - Returns HTTP 200 if ready:
     ```json
     { "status": "ready", "checks": { "config": "ok", "database": "ok", "storage": "ok" } }
     ```
   - Returns HTTP 503 if any dependency is degraded (fails closed, never leaks credentials).

---

## 7. Post-Deployment Smoke Verification Checklist

After initial deployment or container update:

1. [ ] Check health endpoints:
   - `curl -I https://siaga.sparta.co.id/api/health/live` (Expect 200)
   - `curl -I https://siaga.sparta.co.id/api/health/ready` (Expect 200)
2. [ ] Test user authentication:
   - Log in with authorized duty officer / admin credentials.
   - Confirm session cookies include `HttpOnly; Secure; SameSite=Lax`.
3. [ ] Test incident dashboard:
   - Verify active incident list renders correctly.
   - Verify earthquake event polling triggers without database connection pool exhaustion.
4. [ ] Test evidence upload & retrieval:
   - Upload a test progress update with attachment.
   - Confirm image is written to `/app/storage/progress` (persisting across container rebuilds).
5. [ ] Confirm server logs are free from unhandled promise rejections or database connection timeout errors.
