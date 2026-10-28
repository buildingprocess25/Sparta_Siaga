# ============================================================================
# SPARTA SIAGA — Multi-stage Production Dockerfile
# Aligned with SPARTA Enterprise & Dokploy Production Standards
# ============================================================================

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.28.3 --activate
WORKDIR /app

# ----------------------------------------------------------------------------
# 1. Dependencies Stage
# ----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile

# ----------------------------------------------------------------------------
# 2. Builder Stage
# ----------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Defense-in-depth: Prune non-production, test, and simulation artifacts before build
RUN rm -rf \
    tests \
    playwright.config.ts \
    test-api.mjs \
    sparta_p1_qa_report.md \
    public/simulasi-uat \
    public/uploads/progress/orig_INC-TEST* \
    public/uploads/progress/wm_INC-TEST* \
    docs \
    artifacts \
    scratch \
    backups \
    graphify-out \
    .graphify*

# Provide non-secret build placeholders so Next.js static page generation
# does not fail during container image build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV TZ=UTC
ENV DATABASE_URL=postgresql://build_user:build_pass@localhost:5432/build_db
ENV JWT_SECRET=build-time-jwt-secret-placeholder-min-32-chars
ENV SESSION_SECRET=build-time-jwt-secret-placeholder-min-32-chars
ENV SPARTA_INTERNAL_WORKER_SECRET=build-time-worker-secret-placeholder-32-chars

# Build arguments for client-bundled configuration
ARG NEXT_PUBLIC_APP_URL=https://siaga.sparta-alfamart.web.id
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV APP_BASE_URL=$NEXT_PUBLIC_APP_URL

ARG NEXT_PUBLIC_NOTIFICATIONS_ENABLED=true
ENV NEXT_PUBLIC_NOTIFICATIONS_ENABLED=$NEXT_PUBLIC_NOTIFICATIONS_ENABLED

ARG NEXT_PUBLIC_WEB_PUSH_ENABLED=true
ENV NEXT_PUBLIC_WEB_PUSH_ENABLED=$NEXT_PUBLIC_WEB_PUSH_ENABLED

ARG NEXT_PUBLIC_NOTIFICATION_GATE_REQUIRED=true
ENV NEXT_PUBLIC_NOTIFICATION_GATE_REQUIRED=$NEXT_PUBLIC_NOTIFICATION_GATE_REQUIRED

ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

RUN pnpm run build

# ----------------------------------------------------------------------------
# 3. Production Runner Stage
# ----------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=UTC
ENV PORT=3004
ENV HOSTNAME=0.0.0.0
ENV PRIVATE_STORAGE_ROOT=/app/storage

# Install ca-certificates and openssl in runner for external BMKG/USGS APIs and SSL
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Create non-root system user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 nextjs

# Copy static assets and standalone server
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder /app/database ./database
COPY --from=builder /app/data ./data
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/types ./types
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/scripts/migrate-production.mjs ./scripts/migrate-production.mjs
COPY --from=builder /app/scripts/worker-daemon.ts ./scripts/worker-daemon.ts
COPY --from=builder /app/package.json ./package.json

# Create private storage volume directory and grant ownership
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage

USER nextjs

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3004) + '/api/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
