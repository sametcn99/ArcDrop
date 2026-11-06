# Contributing to ArcDrop

Thanks for contributing to ArcDrop, a self-host-first bookmarking platform with cross-platform desktop clients and AI-assisted organization.

## Repository layout

The mandatory folder layout and dependency-direction rules live in `docs/monorepo-structure.md`. In short:

- `apps/web` — Blazor web workspace.
- `apps/desktop` — .NET MAUI desktop client (Avalonia Linux slot reserved).
- `services/ArcDrop.Api` — ASP.NET Core API.
- `packages/ArcDrop.*` — Application, Domain, Infrastructure, and Shared libraries.
- `tests` — test projects.
- `ops` — Docker Compose assets and helper scripts.

## Getting started

1. Install the .NET 10 SDK and Docker.
2. Start PostgreSQL and the API (either through the dev container described in `docs/devcontainer-setup.md`, the compose runbook in `docs/self-host-quickstart.md`, or your own local PostgreSQL).
3. Run the API: `dotnet run --project services/ArcDrop.Api/ArcDrop.Api.csproj` (listens on `http://localhost:5237`).
4. Run the web app: `dotnet run --project apps/web/ArcDrop.Web/ArcDrop.Web.csproj` (listens on `http://localhost:5290`).

## Engineering conventions

- Keep change descriptions, doc headers, and code comments consistent with the existing style of the codebase.
- Secrets are injected through `ARCDROP_`-prefixed environment variables; never commit credentials or signing keys.
- All API data endpoints require an admin bearer token; clients must attach `Authorization: Bearer <token>` headers.

## Building and testing

```powershell
# Build everything except MAUI (MAUI requires platform workloads)
dotnet build services/ArcDrop.Api/ArcDrop.Api.csproj
dotnet build apps/web/ArcDrop.Web/ArcDrop.Web.csproj

# Run the API test suite (integration tests use Testcontainers and need Docker)
dotnet test tests/ArcDrop.Api.Tests/ArcDrop.Api.Tests.csproj
```

MAUI builds need the `maui-android` / `maui-windows` workloads (`dotnet workload install maui`).

## Pull requests

- Keep PRs scoped to one requirement or task slice.
- Update the relevant `docs/` guide and README status list when behavior changes.
- Include integration test coverage for new endpoints or contract changes.
