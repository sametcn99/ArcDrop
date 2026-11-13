#!/bin/sh
# ArcDrop API container entrypoint - plan D11 migrate-on-boot:
# run pending TypeORM migrations, then exec the API server.
# Set ARCDROP_SKIP_MIGRATIONS=1 to boot without migrating (escape hatch; note
# the single underscore - app config uses ARCDROP__, this is shell-only).
set -eu

if [ "${ARCDROP_SKIP_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] ARCDROP_SKIP_MIGRATIONS=1 - skipping migrations"
else
  echo "[entrypoint] running TypeORM migrations..."
  bun /app/apps/api/node_modules/typeorm/cli.js migration:run -d /app/apps/api/dist/database/data-source.cli.js
  echo "[entrypoint] migrations complete"
fi

exec bun /app/apps/api/dist/main.js
