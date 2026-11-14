#!/bin/sh
# AbrIT Portal container entrypoint.
# Applies Prisma migrations (optional seed) before handing over to the
# standalone Next.js server. Migration/seed failures are loud but never
# prevent the server from starting — operators inspect the logs and retry.
set -e

echo "[abrit-portal] RUN_MIGRATIONS=${RUN_MIGRATIONS:-true} SEED_ON_START=${SEED_ON_START:-false}"

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "[abrit-portal] applying Prisma migrations..."
    attempt=1
    until prisma migrate deploy --schema ./prisma/schema.prisma; do
        if [ "$attempt" -ge 5 ]; then
            echo "[abrit-portal] ERROR: required Prisma migrations failed after $attempt attempts" >&2
            exit 1
        fi
        attempt=$((attempt + 1))
        sleep 3
    done
fi

if [ "${SEED_ON_START:-false}" = "true" ]; then
    echo "[abrit-portal] seeding admin/demo/content data..."
    node --experimental-strip-types prisma/seed.ts \
        || echo "[abrit-portal] WARN: seed failed — continuing (idempotent, safe to re-run)"
fi

echo "[abrit-portal] starting standalone server on ${PORT:-3000}"
exec node server.js
