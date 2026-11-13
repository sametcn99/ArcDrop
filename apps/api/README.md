# ArcDrop API (`@arcdrop/api`)

NestJS REST API for ArcDrop — self-hosted, multi-user bookmark platform. Runs on Bun.

**Status:** M0 — workspace bootstrap (scaffold only, no domain features yet).

The full build plan (M0–M9) covers: API foundation (config, TypeORM + PostgreSQL, migrations,
health, OpenAPI/Scalar, problem+json), auth & users, bookmarks core, collections, sync,
metadata & icons, AI, portability, hardening & ops.

## Scripts

| Script              | What it does                                             |
| ------------------- | -------------------------------------------------------- |
| `bun run dev`       | Watch-mode dev server (port from `PORT`, default `3000`) |
| `bun run build`     | Bundle to `dist/` (Nest packages kept external)          |
| `bun run start`     | Run the built bundle                                     |
| `bun run lint`      | ESLint (repo-root flat config)                           |
| `bun run typecheck` | Strict TypeScript check (`tsc --noEmit`)                 |
| `bun test src`      | Unit tests (`bun test`)                                  |

Repo-root scripts (`bun run dev`, `bun run lint`, `bun test`, …) proxy into this app.

## Decisions recorded for this milestone

- **HTTP platform: `@nestjs/platform-express`.** Nest's default; battle-tested and fully
  compatible with Bun's Node.js implementation. Fastify would be a performance swap with
  adapter-level differences (its own router/validation hooks) — no reason to take that on
  before the API foundation (M1) is in place.
- **Tests run on `bun test`** (no Jest). E2e tests boot the real Nest app on a random port and
  speak HTTP with `fetch` — no supertest needed.
- **Path alias `@api/*` → `src/*`** declared in `apps/api/tsconfig.json`; resolved natively by
  Bun and `tsc`.
- **ESLint/Prettier live at the repo root** (one flat config for the whole monorepo); the app's
  `lint` script points at the root config so it also works when run from this directory.
- **Decorator DI probe:** the scaffold injects `AppService` into `AppController` via constructor
  param type metadata (`emitDecoratorMetadata`), so the e2e test proves Nest's DI works under
  Bun before anything builds on it.

## Notes

- `POST /` route info returned by `GET /` is temporary scaffolding per the M0 ticket; M1
  replaces it with the `/api/v1` contract, health endpoints and OpenAPI docs.
- CI (`.github/workflows/ci.yml`) already provisions a PostgreSQL service container for the
  e2e job with `ARCDROP__DATABASE__URL` set — the database itself arrives in M1.
