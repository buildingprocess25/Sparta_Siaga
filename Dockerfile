# ============================================================================
# SPARTA SIAGA — Multi-stage Production Dockerfile
# ============================================================================

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.28.3 --activate
WORKDIR /app

# 1. Dependencies Stage
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./
RUN pnpm install --frozen-lockfile

# 2. Builder Stage
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
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm run build

# 3. Production Runner Stage
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3004
ENV HOSTNAME=0.0.0.0
ENV PRIVATE_STORAGE_ROOT=/app/storage

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
  CMD node -e "fetch('http://localhost:3004/api/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
