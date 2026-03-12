# ArcDrop Dev Container Setup

Supports `FR-001`, `NFR-001`, and `TASK-001` contributor environment onboarding.

## What The Dev Container Includes

- .NET SDK 10.0 for API, web host, packages, and test projects.
- PostgreSQL 16 sidecar service for local backend development.
- Docker CLI access for running the self-host stack from inside the container when needed.
- Node.js LTS so the docs workspace can add VitePress assets without rebuilding the base image.
- Automatic first-run bootstrap for `ops/docker/.env`, `dotnet tool restore`, and `dotnet restore`.

## Open The Repository In The Container

1. Install Docker Desktop and the VS Code Dev Containers extension.
2. Open the ArcDrop repository in VS Code.
3. Run `Dev Containers: Reopen in Container`.

The first container start restores packages and creates `ops/docker/.env` if it is missing.

## Generated Development Environment Values

The bootstrap script copies `ops/docker/.env.example` to `ops/docker/.env` and generates local-only values for:

- `ARCDROP_POSTGRES_PASSWORD`
- `ARCDROP_ADMIN_PASSWORD`
- `ARCDROP_JWT_SIGNING_KEY`
- `ARCDROP_ConnectionStrings__ArcDropPostgres`

The generated PostgreSQL connection string targets the `postgres` service inside the dev container network, so the existing API and web debug profiles can run without manual edits.

## Recommended Development Flow

1. Start `ArcDrop API (Development)` from the VS Code debugger.
2. Start `ArcDrop Web (Development)` or the `ArcDrop API + Web (Development)` compound profile.
3. Use the available endpoints:

    - API: `http://localhost:5237`
    - Web: `http://localhost:5290`
    - PostgreSQL from the host: `localhost:55432`

The application and tests inside the dev container continue to use the `postgres` service on container port `5432`. The host port is only for tools running on the Windows side.

If `55432` is also in use on the host, set `ARCDROP_DEVCONTAINER_POSTGRES_HOST_PORT` before reopening the container so Docker publishes PostgreSQL on a different local port.

## Optional Docker-Based Self-Host Validation

The container also includes Docker CLI support, so you can validate the production-style stack from inside the workspace when required:

```bash
docker compose --env-file ops/docker/.env -f ops/docker/docker-compose.yml up -d --build
docker compose --env-file ops/docker/.env -f ops/docker/docker-compose.yml down
```

## Troubleshooting

- PostgreSQL is not reachable from the API debugger:
  - Confirm the `postgres` service is running in the Dev Containers panel.
  - Check that `ops/docker/.env` contains `ARCDROP_ConnectionStrings__ArcDropPostgres=Host=postgres;...`.
- The dev container fails to start with a PostgreSQL port allocation error:
  - Another process is already using the configured host port.
  - Set `ARCDROP_DEVCONTAINER_POSTGRES_HOST_PORT` to an unused local port and reopen the container.
- The first container build fails during feature installation:
  - Rebuild the container after Docker Desktop finishes starting.
- Package restore fails on first boot:
  - Re-run `bash .devcontainer/post-create.sh` from the integrated terminal.
