# =============================================================================
# AbrIT Portal — Next.js 16 (public site, customer portal, commerce API)
#
# Multi-stage build:
#   deps   : bun install + Prisma client generation (cached layer)
#   build  : `next build` producing the standalone server bundle
#   runner : slim Node runtime + Prisma CLI for `migrate deploy`
#
# The portal proxies every non-Next.js path (e.g. /admin, /Login) to the REAL
# Orchard Core CMS container (ORCHARD_PROXY_TARGET=http://cms:5000 in compose).
#
# RUNS AS NON-ROOT (audit §3.3): the runner creates a dedicated `abrit` user
# (uid/gid 10001) and drops to it for the entrypoint and server process. The
# entrypoint only needs to READ /app (migrations + server bundle) and talk to
# PostgreSQL over the network — no writable host paths are required, so no
# chown dance is needed and Prisma migrations keep working unchanged.
# ============================================================================

# ---------- deps: install JS dependencies + generate the Prisma client -------
FROM oven/bun:1.3 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile
RUN bunx prisma generate

# ---------- build: compile the standalone Next.js server ----------------------
FROM oven/bun:1.3 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No live database is required at build time: pricing is read at request time.
RUN bun run build:docker

# ---------- runner: minimal production runtime ---------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# openssl: required by Prisma engines; curl: container healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/* \
    # Dedicated non-root runtime user (mirrors the CMS container uid/gid).
    && groupadd --system --gid 10001 abrit \
    && useradd --system --uid 10001 --gid abrit --home-dir /app --no-create-home abrit

# Prisma CLI for `migrate deploy` at container start (see entrypoint)
RUN npm install -g --no-audit --no-fund prisma@6.11.1

# The package.json build script already copies .next/static and public/
# into .next/standalone — one copy is enough.
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/prisma ./prisma
COPY --chmod=0755 docker/portal-entrypoint.sh /app/entrypoint.sh

# Nothing in /app needs to be writable at runtime (the standalone server keeps
# no local state; migrations write to PostgreSQL, not the filesystem).
RUN chown -R 10001:10001 /app
USER abrit

# Full-remediation audit §7: the image itself reports health (previously only
# docker-compose defined a healthcheck — a bare `docker run` reported healthy
# while the app could be down).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=10 \
  CMD curl -fsS http://127.0.0.1:3000/api/health >/dev/null || exit 1

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
