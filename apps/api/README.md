# ArcDrop API (`@arcdrop/api`)

NestJS REST API for ArcDrop — self-hosted, multi-user bookmark platform. Runs on Bun.

**Status:** M1 — API foundation (validated config, TypeORM + PostgreSQL + migrations,
health probes, OpenAPI + Scalar, problem+json errors, structured logging, Docker/compose
bundle passing the Bun production gate). Next: M2 — auth & users.

The full build plan (M0–M9) covers: API foundation, auth & users, bookmarks core,
collections, sync, metadata & icons, AI, portability, hardening & ops.

## Scripts

| Script                       | What it does                                                  |
| ---------------------------- | ------------------------------------------------------------- |
| `bun run dev`                | Watch-mode dev server (needs env vars, see below)             |
| `bun run build`              | Bundle to `dist/` (`main.js` + `database/data-source.cli.js`) |
| `bun run start`              | Run the built bundle                                          |
| `bun run lint`               | ESLint (repo-root flat config)                                |
| `bun run typecheck`          | Strict TypeScript check (`tsc --noEmit`)                      |
| `bun test src`               | Unit tests (`bun test`)                                       |
| `bun test e2e`               | E2E tests (need `ARCDROP__DATABASE__URL`)                     |
| `bun run migration:run`      | Build, then run pending migrations via the TypeORM CLI        |
| `bun run migration:revert`   | Build, then revert the last migration                         |
| `bun run migration:generate` | Build, then generate a migration (see Migration workflow)     |

Repo-root scripts (`bun run dev`, `bun run lint`, `bun test`, …) proxy into this app.

## Environment

Config is validated with zod at boot (fail-fast: invalid env → report with the offending
`ARCDROP__*` names → exit 1). Prefix `ARCDROP__`, double-underscore nesting
(`ARCDROP__DATABASE__URL` → `database.url`). Unknown `ARCDROP__*` keys are rejected
(typo protection). Copy `.env.example` to `.env` for local dev — bun loads it
automatically.

| Variable                    | Required | Default | Meaning                                                  |
| --------------------------- | -------- | ------- | -------------------------------------------------------- |
| `ARCDROP__DATABASE__URL`    | yes      | —       | PostgreSQL connection URL (`postgres://…`)               |
| `ARCDROP__JWT__SECRET`      | yes      | —       | JWT signing secret, min 32 chars (used from M2)          |
| `ARCDROP__PORT`             | no       | `3000`  | HTTP port                                                |
| `ARCDROP__CORS__ORIGINS`    | no       | empty   | Comma-separated browser origins; empty = CORS off        |
| `ARCDROP__DATA_DIR`         | no       | `/data` | Data volume root (icons/uploads later); must be writable |
| `ARCDROP__METRICS__ENABLED` | no       | `false` | Serve Prometheus metrics at `/metrics`                   |
| `ARCDROP__LOG__LEVEL`       | no       | `info`  | pino level: `fatal…trace`                                |

## Local development

```sh
bun install
# one-off Postgres (or use the compose db service)
docker run -d --name arcdrop-pg -e POSTGRES_USER=arcdrop -e POSTGRES_PASSWORD=arcdrop \
  -e POSTGRES_DB=arcdrop -p 5432:5432 postgres:16-alpine
bun run dev            # or: bun --cwd=apps/api run dev from the repo root
```

Tests: `bun test src` (unit) needs no services; `bun test e2e` boots the real app against
`ARCDROP__DATABASE__URL` (CI provisions a Postgres service container and sets exactly
that variable).

## HTTP contract

- **Versioning (D9):** URI versioning, `defaultVersion: '1'`, global prefix `api` →
  every Nest route lives under `/api/v1/...`.
- **Errors (D9):** every error is RFC 7807 `application/problem+json`
  (`charset=utf-8`) with `type`, `title`, `status`, machine-readable `code`, human
  `detail`, plus `instance` and `requestId` extensions. Validation failures are `400`
  with `code: VALIDATION_FAILED` and per-field `errors: [{field, messages}]`.
  Stable code map lives in `src/common/problem-json/problem-codes.ts` — add new
  statuses there, never inline codes in features.
- **Correlation:** request id = incoming `x-request-id` (or a minted UUID), echoed on
  every response and attached to request logs, error logs, and problem bodies.
- **Docs:** OpenAPI 3 at `/openapi.json`, Scalar UI at `/docs` (the UI bundle comes
  from the jsdelivr CDN; the document itself is served locally — codegen never needs
  the network). Metrics (optional) at `/metrics`.

**Operation-ID convention:** every route sets an explicit
`@ApiOperation({ operationId: '<camelCaseVerb><Resource>' })` (e.g. `getReadiness`,
`createBookmark`). The e2e suite fails if any operation in the generated document
lacks an ID — the IDs are what all four clients generate code from.

**Error-code additions for new modules:** extend `problemForStatus` in
`problem-codes.ts`; feature modules never throw with bespoke status codes.

## Database (D1, D11)

PostgreSQL only, TypeORM, `synchronize: false` always — schema changes go through
generated migrations.

- `src/database/entities/` — explicit entity list (NO globs; globs break `bun build`).
  Empty until M2 ships the first entity.
- `src/database/migrations/` — explicit migration list + the no-op
  `InitialSetup1763000000000` pipeline proof.

### Migration workflow

```sh
# after editing/adding entities:
bun run migration:generate src/database/migrations CreateUser        # generates <ts>-create-user.ts
# then: add the generated class to src/database/migrations/index.ts (explicit list!)
bun run migration:run
bun run migration:revert     # undo the last one
```

- The CLI datasource is `src/database/data-source.cli.ts`, bundled to
  `dist/database/data-source.cli.js` (TypeORM's CLI cannot load TS on its own; the
  bundle is what the container entrypoint uses too — dev/prod parity).
- Naming convention for hand-written migrations: file `<unixMs>-<PascalName>.ts`,
  class `<PascalName><unixMs>`. Prefer `migration:generate` so timestamps are
  authoritative.
- `bun run build` produces TWO entry points: `dist/main.js` (server) and
  `dist/database/data-source.cli.js` (CLI datasource).

## Docker & compose (D8 — Bun production gate)

- `apps/api/Dockerfile` — multi-stage `oven/bun:1.4.2-alpine`; build stage bundles,
  runtime stage installs **production deps only** (`bun install --production` works
  correctly from manifests in a fresh stage; pruning an existing workspace install
  does NOT — see the note in the Dockerfile).
- Entrypoint (`apps/api/docker-entrypoint.sh`) is **migrate-on-boot**: TypeORM
  `migration:run`, then `exec bun dist/main.js`. Escape hatch:
  `ARCDROP_SKIP_MIGRATIONS=1` (single underscore — shell-only, never validated by the
  app config).
- `compose.yaml` (repo root) — API + PostgreSQL 16, named volumes, healthchecks
  (the API probe is a `bun -e` fetch of `/api/v1/readyz`), `restart: unless-stopped`.
  Verified: clean `docker compose up` → healthy → migrations applied → `readyz` 200.

```sh
docker compose up --build        # from the repo root
```

## Module map (as of M1)

```
src/
  main.ts                  fail-fast boot: validate env → mkdir data dir → serve
  app.module.ts            root module (imports below + global problem+json filter)
  app-setup.ts             shared wiring: logger, versioning, pipes, CORS, docs, infra routes
  config/                  env loading + zod schema + typed AppConfigService (APP_CONFIG token)
  common/                  problem+json filter & codes, validation pipe factory
  logging/                 nestjs-pino (correlation ids, redaction)
  database/                TypeORM DataSource, entities/, migrations/, CLI datasource
  health/                  GET /api/v1/healthz (process), GET /api/v1/readyz (DB + data dir)
  metrics/                 prom-client registry; /metrics route only when enabled
test/
  helpers.ts               e2e env bootstrap (only ARCDROP__DATABASE__URL must be preset)
  api-foundation.e2e.test.ts   full contract suite (two boots: default + metrics/CORS on)
```

Both `main.ts` and the e2e boots go through `app-setup.ts` — keep runtime behavior and
tests in lockstep by wiring new app-level concerns THERE.

## Decisions recorded (M1)

- **Support libs pinned to Nest 11** (`@nestjs/config@12`/`typeorm@12` peers accept
  11; `@nestjs/swagger` must stay on v11 — v12 requires Nest 12).
- **`@nestjs/config` carries the env; typed access goes through `AppConfigService`.**
  Everything injects the service (or overrides the `APP_CONFIG` token), never reads
  `process.env` directly. zod v4 gotcha encoded in `loadConfig`: absent object
  sections are pre-filled with `{}` so a missing var reports at its own name.
- **Raw express routes (`/openapi.json`, `/docs`, `/metrics`) are registered BEFORE
  `app.init()`** — after init they'd land behind Nest's catch-all and 404.
- **prom-client 15 default metrics are scrape-time and Bun-aware** — no timers to
  stop; `--production` install prunes dev deps correctly only from manifests.
- **problem+json content-type is set with explicit `charset=utf-8`** — Express
  otherwise appends its own; clients match the base media type.
- **TypeORM CLI runs the bundled `dist/database/data-source.cli.js`** — avoids
  ts-node entirely and matches the container entrypoint exactly.
- **CI e2e needs exactly one env var**: `ARCDROP__DATABASE__URL` (already wired).
  M0's `GET /` scaffold route was replaced by the `/api/v1` contract, per the M1
  ticket scope; its tests were replaced, not preserved.

## Notes

- OpenAPI/Scalar docs: `/docs` (Scalar UI), `/openapi.json` (document).
- CI (`.github/workflows/ci.yml`) provisions a PostgreSQL 17 service container for
  the e2e job; compose ships PostgreSQL 16 (per plan) — same dialect, flagged for
  alignment.
