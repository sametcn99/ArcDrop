# ArcDrop Self-Host Quickstart

Implements `FR-002`, `NFR-002`, and `TASK-012`.

## Prerequisites

- Docker Desktop or Docker Engine with Compose support.
- .NET SDK 10.0 (for local development and optional migration commands).

For a containerized contributor environment with PostgreSQL, SDK tooling, and forwarded debug ports already configured, see `docs/devcontainer-setup.md`.

## 1. Prepare Environment Variables

1. Open `ops/docker/.env.example`.
2. Copy it as `ops/docker/.env`.
3. Replace all placeholder secrets with strong values.

Critical values to set securely:

- `ARCDROP_POSTGRES_PASSWORD`
- `ARCDROP_ADMIN_PASSWORD`
- `ARCDROP_JWT_SIGNING_KEY` (minimum 32 characters)

## 2. Start The Stack

From repository root:

```powershell
docker compose --env-file ops/docker/.env -f ops/docker/docker-compose.yml up -d --build
```

### Optional Single-Command Dev Startup (Backend + Blazor)

For local development, you can start backend containers, wait for health readiness, and launch Blazor in one command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/arcdrop-dev.ps1 start
```

Additional helper commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/arcdrop-dev.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/arcdrop-dev.ps1 stop
```

## 3. Verify Health

```powershell
curl http://localhost:8080/health
```

Expected outcome: HTTP 200 with `Status` equal to `Healthy`.

## 4. Login As Fixed Admin

```powershell
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your-admin-password>"}'
```

Expected outcome: HTTP 200 with `accessToken` and `expiresAtUtc`.

## 5. Rotate Admin Password

Use the access token from the login response in the `Authorization` header.

```powershell
curl -X POST http://localhost:8080/api/auth/rotate-password \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"<old-password>","newPassword":"<new-strong-password>"}'
```

Expected outcome: HTTP 204 with empty body.

Password policy defaults require minimum 12 characters including uppercase, lowercase, digit, and special character.

## 6. Stop The Stack

```powershell
docker compose --env-file ops/docker/.env -f ops/docker/docker-compose.yml down
```

To remove PostgreSQL data volume as well:

```powershell
docker compose --env-file ops/docker/.env -f ops/docker/docker-compose.yml down -v
```

## Troubleshooting

- API health check fails immediately:
  - Check `.env` values and ensure `ARCDROP_JWT_SIGNING_KEY` length is at least 32.
- PostgreSQL connection failures:
  - Verify `ARCDROP_POSTGRES_*` values are consistent between compose and API connection string.
- Login always returns unauthorized:
  - Ensure `ARCDROP_ADMIN_USERNAME` and `ARCDROP_ADMIN_PASSWORD` are set and match your login payload.
