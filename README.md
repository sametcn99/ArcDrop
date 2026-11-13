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

## Commands (repo root)

| Command                | What it does                          |
| ---------------------- | ------------------------------------- |
| `bun install`          | Install all workspace dependencies    |
| `bun run dev`          | Run the API in watch mode             |
| `bun run build`        | Build the API                         |
| `bun run lint`         | ESLint over the repo                  |
| `bun run format:check` | Prettier check over the repo          |
| `bun run typecheck`    | TypeScript strict typecheck (per app) |
| `bun test`             | All tests (unit + e2e)                |
| `bun run test:unit`    | API unit tests only                   |
| `bun run test:e2e`     | API e2e tests only                    |

## Status

The API is being rebuilt milestone by milestone — current progress is tracked in
`apps/api/README.md`.
