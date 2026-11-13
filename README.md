# ArcDrop

Self-hosted, multi-user bookmark platform serving web, desktop, mobile and browser-extension
clients from a single API.

## Repository layout

| Path             | What lives here                                             |
| ---------------- | ----------------------------------------------------------- |
| `apps/api`       | NestJS REST API (the first app being built; see its README) |
| `apps/web`       | Web SPA (skeleton, not started)                             |
| `apps/desktop`   | Desktop client (skeleton, not started)                      |
| `apps/mobile`    | Mobile client (skeleton, not started)                       |
| `apps/extension` | Browser extension (skeleton, not started)                   |

## Tooling

- **Bun everywhere** — Bun workspaces, `bun install`, `bun run`, `bun test`. No npm/yarn/pnpm;
  `bun.lock` is the only lockfile.
- **ESLint + Prettier at the repo root** — one flat config (`eslint.config.mjs`) and one
  `.prettierrc` cover every workspace for now; apps can override later if a client framework
  demands it (kept simple on purpose).
- **CI** — GitHub Actions runs lint, format check, typecheck, unit tests, and an e2e job with a
  PostgreSQL service container (`.github/workflows/ci.yml`).

## Requirements

- [Bun](https://bun.sh) >= 1.2 (development happens on 1.4.x, CI pins the same minor)
- [Docker](https://docs.docker.com/get-docker/) with Compose (to run the API +
  PostgreSQL bundle, or to provide a throwaway Postgres for tests)

## Commands (repo root)

| Command                | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| `bun install`          | Install all workspace dependencies                          |
| `bun run dev`          | Run the API in watch mode                                   |
| `bun run build`        | Build the API                                               |
| `bun run lint`         | ESLint over the repo                                        |
| `bun run format:check` | Prettier check over the repo                                |
| `bun run typecheck`    | TypeScript strict typecheck (per app)                       |
| `bun test`             | All tests (unit + e2e)                                      |
| `bun run test:unit`    | API unit tests only                                         |
| `bun run test:e2e`     | API e2e tests only                                          |
| `docker compose up`    | API + PostgreSQL 16 bundle (migrate-on-boot, healthchecked) |

The compose bundle reads `.env` next to `compose.yaml` — see `.env.example`.
`ARCDROP__JWT__SECRET` is required (compose refuses to boot without it):
`openssl rand -hex 32`.

## Status

The API is being rebuilt milestone by milestone — current progress is tracked in
`apps/api/README.md`. M1 (API foundation) is complete: validated `ARCDROP__` config,
TypeORM + PostgreSQL with migrate-on-boot, `/api/v1` health probes, OpenAPI 3 +
Scalar docs, RFC 7807 errors, pino logs with request correlation, optional
`/metrics`, and a compose bundle that passes the Bun production gate.
