# syntax=docker/dockerfile:1.7
# Multi-stage build. Final image ~150MB on Alpine.
# Built and pushed by .github/workflows/docker.yml on tag pushes.

# -----------------------------------------------------------------------------
# Stage 1: build TypeScript and produce dist/
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build deps for better-sqlite3 source compile fallback (the alpine
# musl prebuilt should be picked first, but keep the toolchain available so
# we don't fail silently if a future better-sqlite3 release drops the prebuild).
RUN apk add --no-cache python3 make g++

# Install all deps from lockfile (prod + dev) — we need devDeps for tsc.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source and compile (TS → dist/, Astro → dist/ui/).
COPY tsconfig.json tsconfig.build.json astro.config.mjs ./
COPY src ./src
COPY pricing ./pricing
RUN npm run build

# Trim devDeps for the runtime stage.
RUN npm prune --omit=dev

# -----------------------------------------------------------------------------
# Stage 2: minimal runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    POLARIS_HOST=0.0.0.0 \
    POLARIS_PORT=3000 \
    POLARIS_DB_PATH=/data/polaris.db

# Non-root user for least-privilege.
RUN addgroup -g 1001 -S polaris && \
    adduser -u 1001 -S polaris -G polaris && \
    mkdir -p /data && \
    chown polaris:polaris /data

# Copy the bare minimum from builder.
COPY --from=builder --chown=polaris:polaris /app/node_modules ./node_modules
COPY --from=builder --chown=polaris:polaris /app/dist ./dist
COPY --from=builder --chown=polaris:polaris /app/pricing ./pricing
COPY --chown=polaris:polaris package.json ./

USER polaris

EXPOSE 3000

# Persistence: mount a host directory at /data so the SQLite file survives container restarts.
VOLUME ["/data"]

# /health is unauthenticated, perfect for HEALTHCHECK.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O - http://127.0.0.1:3000/health | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["node", "dist/server.js"]
