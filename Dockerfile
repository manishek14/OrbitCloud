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
# =============================================================================

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
    && rm -rf /var/lib/apt/lists/*

# Prisma CLI for `migrate deploy` at container start (see entrypoint)
RUN npm install -g --no-audit --no-fund prisma@6.11.1

# The package.json build script already copies .next/static and public/
# into .next/standalone — one copy is enough.
COPY --from=build /app/.next/standalone ./
COPY prisma ./prisma
COPY --chmod=0755 docker/portal-entrypoint.sh /app/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
