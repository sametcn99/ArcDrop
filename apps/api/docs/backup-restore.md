# ArcDrop API — Backup, Restore, Upgrade & Ops Hardening Guide

This guide covers day-2 operations for the ArcDrop Docker Compose bundle ([`compose.yaml`](../../../compose.yaml)): PostgreSQL backups, `/data` volume snapshots, secrets management, zero-surprise upgrades, reverse-proxy TLS termination, and Wave-1 security revisit assessments.

---

## 1. Backup Procedure (PostgreSQL + `/data` Volume)

Back up PostgreSQL and the entire `arcdrop-data` volume together. The volume
contains cached icons, archives and private uploaded files. Stop the API
writer before taking both snapshots so file references and their bytes
describe the same state. Store a protected copy of the configured JWT and
TOTP keys with the recovery materials.

```bash
# 1. Choose a timestamped backup directory
BACKUP_DIR="./backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

# 2. Quiesce the API writer (recommended for DB + icon cache consistency)
docker compose stop api

# 3. Dump PostgreSQL in custom archive format (-Fc)
docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-arcdrop}" \
  -d "${POSTGRES_DB:-arcdrop}" \
  -Fc \
  > "$BACKUP_DIR/arcdrop.pgdump"

# 4. Archive the arcdrop-data volume (/data)
#    Adjust volume name if your compose project name is not `arcdrop`.
docker run --rm \
  -v arcdrop_arcdrop-data:/data:ro \
  -v "$(pwd)/$BACKUP_DIR:/backup" \
  alpine:3.20 \
  tar -czf /backup/arcdrop-data.tar.gz -C /data .

# 5. Resume the API
docker compose start api
```

---

## 2. Restore Procedure

> **Warning:** Restoring replaces the current database contents and `/data` directory. Verify the backup files exist and are non-empty before proceeding.

```bash
BACKUP_DIR="./backups/<timestamp>"

# 1. Stop the API so no connections or writes remain open
docker compose stop api

# 2. Ensure Postgres is up and healthy
docker compose up -d db

# 3. Recreate a clean database and restore the pg_dump archive
docker compose exec -T db psql -U "${POSTGRES_USER:-arcdrop}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB:-arcdrop} WITH (FORCE);" \
  -c "CREATE DATABASE ${POSTGRES_DB:-arcdrop} OWNER ${POSTGRES_USER:-arcdrop};"

docker compose exec -T db pg_restore \
  -U "${POSTGRES_USER:-arcdrop}" \
  -d "${POSTGRES_DB:-arcdrop}" \
  --no-owner \
  --no-privileges \
  < "$BACKUP_DIR/arcdrop.pgdump"

# 4. Restore the /data volume
docker run --rm \
  -v arcdrop_arcdrop-data:/data \
  -v "$(pwd)/$BACKUP_DIR:/backup:ro" \
  alpine:3.20 \
  sh -c "rm -rf /data/* && tar -xzf /backup/arcdrop-data.tar.gz -C /data"

# 5. Start the API (migrate-on-boot runs any pending migrations if restoring
#    into a newer image) and verify readiness
docker compose up -d --wait
curl -fsS http://127.0.0.1:3000/api/v1/readyz
```

Expected `/api/v1/readyz` response:

```json
{
  "status": "ok",
  "checks": {
    "database": "ok",
    "dataDir": "ok"
  }
}
```

---

## 3. TOTP keys and JWT rotation

A fresh instance should use separately generated `ARCDROP__JWT__SECRET` and
`ARCDROP__TOTP__ENCRYPTION_KEY`. Existing deployments without a dedicated TOTP
key can continue to open legacy TOTP records using their original JWT secret.

1. Take the database and data backups and retain the original keys.
2. Leave the JWT secret in place and add a new random `ARCDROP__TOTP__ENCRYPTION_KEY`.
   For a dedicated TOTP key rotation, put the old TOTP key in
   `ARCDROP__TOTP__PREVIOUS_ENCRYPTION_KEY`.
3. After deploying the new image, stop the API and run the maintenance command.
   It converts enabled and pending TOTP records in one transaction. Rerunning
   it leaves records already encrypted with the new key intact.

   ```bash
   docker compose stop api
   docker compose run --rm --no-deps --entrypoint bun api /app/apps/api/dist/scripts/rotate-totp-key.js
   docker compose up -d --wait
   ```

4. Verify TOTP sign-in and rerun the command to confirm that there are zero
   records left to rotate. Then rotate the JWT secret or remove the previous
   TOTP key, as applicable. Recreate the API with the updated configuration.

For rollback to the previous application, restore the pre-rotation database
and data volume with their matching keys. Keep recovery codes available
separately from server backups.

---

## 4. Upgrade Path

Keep the same Compose project name and the existing PostgreSQL and JWT
settings. The new web service takes ownership of the published port. Restart
the project without deleting its volumes. If network clients previously
connected directly, configure the new listener and HTTPS before switching
them. The default address is `127.0.0.1:3000`.

1. **Back up first**: Follow [Section 1](#1-backup-procedure-postgresql--data-volume).
2. **Pull or rebuild the new image**:
   ```bash
   docker compose build api web
   ```
3. **Rolling container swap with migrate-on-boot**:
   `apps/api/docker-entrypoint.sh` executes TypeORM `migration:run` before starting `bun dist/main.js` (plan D11).
   ```bash
   docker compose up -d --wait
   ```
4. **Verify health & readiness**:
   ```bash
   docker compose ps
   curl -fsS http://127.0.0.1:3000/api/v1/readyz
   ```
   Wait until `arcdrop-api-1` reports `(healthy)` and `/api/v1/readyz` returns `200`.

**Rollback**: Stop `api`, restore the pre-upgrade `pg_dump` + `/data` archive (Section 2), and start the previous image tag (`ARCDROP_SKIP_MIGRATIONS=0`).

---

## 5. Reverse-Proxy TLS Termination

Terminate TLS at the upstream and proxy the entire site to the Compose
web port. Set `ARCDROP__PUBLIC__BASE_URL=https://bookmarks.example.com`
for public RSS links. Set `ARCDROP_WEB_TRUSTED_PROXY_CIDRS` to the
space-separated addresses or CIDRs of the upstream proxies as seen by the web
container. For a host-local proxy, this is often the Docker gateway address.
Keep the web port bound to loopback when the upstream runs on the same host.
For a standalone API, set the comma-separated
`ARCDROP__HTTP__TRUSTED_PROXIES` to the immediate trusted proxy addresses.

The trusted proxy should replace client forwarding headers. Increase its
request-body limit when raising ArcDrop's compressed ZIP upload limit. Use
HTTPS for network deployments so browsers can coordinate persisted sessions
across tabs. A browser without Web Locks keeps its session in the tab until
that tab is reloaded or closed.

### Caddy (recommended — automatic HTTPS + WebSockets)

```caddyfile
bookmarks.example.com {
    # Allow up to 310 MB for ZIP portability imports (above API's 300 MB cap).
    request_body {
        max_size 310MB
    }

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name bookmarks.example.com;

    ssl_certificate     /etc/letsencrypt/live/bookmarks.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bookmarks.example.com/privkey.pem;

    # Match ZIP portability upload limit (300 MB + multipart framing overhead)
    client_max_body_size 310m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Required for /api/v1/sync/ws WebSocket push
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-Id $request_id;
    }
}
```

---

## 6. Security & Hardening Revisit Notes (M9)

### Revisit #1 — SSRF Fetcher DNS-Rebinding Window (from M6)

- **What M6 built**: `SsrfSafeFetchService` (`apps/api/src/metadata/ssrf-safe-fetch.service.ts`) enforces HTTP/HTTPS-only schemes, validates literal IPs and resolves every hostname at hop 0 and **each redirect hop** (`redirect: 'manual'`, max 5 hops), blocking loopback, RFC 1918 private ranges, CGNAT (`100.64.0.0/10`), link-local / cloud metadata (`169.254.0.0/16`), multicast, and IPv6 ULA (`fc00::/7`) / IPv4-mapped IPv6 (`::ffff:...`).
- **Limitation on Bun runtime**: Bun 1.4.2's `fetch()` does not expose a custom socket/DNS `lookup` hook to pin the exact validated IP address into the TCP `connect()` call. Therefore, a narrow **time-of-check to time-of-use (TOCTOU) DNS-rebinding window** exists between DNS resolution in JS and the subsequent `fetch()` socket connection.
- **Residual risk assessment**: **Low** in typical deployments because:
  1. Only authenticated users can trigger fetches (`POST /bookmarks`, `PATCH /bookmarks/:id`, `POST /bookmarks/:id/reindex`), and `reindex` is per-user rate-limited (30/min).
  2. Redirects are manually re-verified on every hop; response bodies are size-capped (`2 MiB` HTML, `1 MiB` images) and content-type gated (`text/html`/`application/xhtml+xml` or non-SVG `image/*`); raw response bodies are never returned to callers (only parsed `<title>`/`<meta>` text and re-saved raster/ICO bytes).
- **Recommended operational mitigations**:
  - **Egress firewall / Docker network policy (strongest)**: block outbound connections from the `api` container to RFC 1918, `169.254.169.254/32` (cloud metadata), `100.64.0.0/10`, and `fc00::/7`.
  - **DNS-rebinding-protected resolver**: point the host/container DNS to a resolver that strips private answers (e.g., Unbound `private-address: 10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `fc00::/7`).
  - Keep `ARCDROP__METADATA__ALLOW_PRIVATE=false` (default) in all non-test environments.

### Revisit #2 — JSON Body Limit (from M8)

- M8 temporarily raised the global `express.json()` limit from `100 KB` to `2 MB` so the MCP `importData` tool could carry base64-encoded imports.
- In M9, `setupApp` scopes the `2 MB` JSON parser exclusively to `/api/v1/mcp` and tightens the global REST JSON parser to `256 KB`. Oversized JSON requests return RFC 7807 `413 Payload Too Large` (`application/problem+json`) with request correlation IDs intact. Multipart file imports (`POST /api/v1/data/import`) stream through `multer` with `ARCDROP__PORTABILITY__IMPORT_MAX_BYTES` (`25 MiB`) and `ARCDROP__PORTABILITY__IMPORT_ZIP_MAX_BYTES` (`300 MB`).

## Portability performance check

On Linux, start a disposable empty API database with a name ending in
`_bench`, migrate it, and launch the API with metadata fetching disabled.
Run the following from `apps/api` with the same database environment and
the PID of that API process.

```bash
ARCDROP_BENCH_PID=12345 ARCDROP_BENCH_URL=http://127.0.0.1:3000 \
  bun scripts/benchmark-portability.ts
```

The script measures warm search latency at 10,000 and 50,000 bookmarks
and samples peak resident memory during a ZIP export and re-import with
two 16 MiB attachments. Run it again with an empty database for comparable
measurements. The numbers represent the test host, library fixture and
current process, so record them together.
