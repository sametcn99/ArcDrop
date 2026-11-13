# ArcDrop API (`@arcdrop/api`)

NestJS REST API for ArcDrop — self-hosted, multi-user bookmark platform. Runs on Bun.

**Status:** M2 — auth & users (M1 foundation + first-run admin bootstrap, bearer JWT
auth with rotating refresh tokens and reuse detection, sessions, admin user
management with single-use invite/reset tokens, DB-backed instance settings,
route throttling). Next: M3 — bookmarks core.

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
that variable). Locally, a throwaway container on a non-default port keeps your dev
database untouched — the e2e suite wipes the auth tables it owns, but run it against a
scratch DB anyway:

```sh
docker run -d --name arcdrop-e2e-pg -e POSTGRES_USER=arcdrop -e POSTGRES_PASSWORD=arcdrop \
  -e POSTGRES_DB=arcdrop_test -p 55432:5432 postgres:16-alpine
$env:ARCDROP__DATABASE__URL = 'postgres://arcdrop:arcdrop@localhost:55432/arcdrop_test'  # PowerShell
bun test e2e
docker rm -f arcdrop-e2e-pg   # throw it away afterwards
```

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
  `User`, `RefreshToken`, `OneTimeToken` (M2 auth), `Setting` (D16 runtime settings).
- `src/database/migrations/` — explicit migration list + the no-op
  `InitialSetup1763000000000` pipeline proof and `M2AuthUsers1794606603617`
  (users/refresh_tokens/one_time_tokens/settings + the three enum types).

### Migration workflow

```sh
# after editing/adding entities:
bun run migration:generate src/database/migrations/NewEntityName
#   → generates <unixMs>-NewEntityName.ts  (ONE positional: the path INCLUDING
#     the class-style name — this TypeORM version takes no separate name arg)
# then: add the generated class to src/database/migrations/index.ts (explicit list!)
bun run migration:run
bun run migration:revert     # undo the last one
```

- The CLI datasource is `src/database/data-source.cli.ts`, bundled to
  `dist/database/data-source.cli.js` (TypeORM's CLI cannot load TS on its own; the
  bundle is what the container entrypoint uses too — dev/prod parity). It validates
  the WHOLE env — migration commands need `ARCDROP__DATABASE__URL` **and**
  `ARCDROP__JWT__SECRET` set.
- `uuidExtension: 'pgcrypto'` is set on the datasource: generated UUID PKs use
  PG13+ core `gen_random_uuid()` — no uuid-ossp extension in migrations.
- Naming convention for hand-written migrations: file `<unixMs>-<PascalName>.ts`,
  class `<PascalName><unixMs>`. Prefer `migration:generate` so timestamps are
  authoritative.
- `bun run build` produces TWO entry points: `dist/main.js` (server) and
  `dist/database/data-source.cli.js` (CLI datasource). Native modules
  (`@node-rs/argon2`) are emitted as `.node` ASSETS next to the bundles and
  `__require`d from `dist/` — the Dockerfile copies the whole `dist/` folder, which
  is why that matters.

## Docker & compose (D8 — Bun production gate)

- `apps/api/Dockerfile` — multi-stage `oven/bun:1.4.2-alpine`; build stage bundles,
  runtime stage installs **production deps only** (`bun install --production` works
  correctly from manifests in a fresh stage; pruning an existing workspace install
  does NOT — see the note in the Dockerfile).
- Entrypoint (`apps/api/docker-entrypoint.sh`) is **migrate-on-boot**: TypeORM
  `migration:run`, then `exec bun dist/main.js`. Escape hatch:
  `ARCDROP_SKIP_MIGRATIONS=1` (single underscore — shell-only, never validated by the
  app config).
- **`ARCDROP__JWT__SECRET` is hard-required by compose** (`${VAR:?…}` — no default
  signing secret, since a predictable secret means forgeable admin tokens). Set it in
  your shell or a `.env` next to `compose.yaml` (`openssl rand -hex 32`); compose
  fails fast with a clear message otherwise.
- `compose.yaml` (repo root) — API + PostgreSQL 16, named volumes, healthchecks
  (the API probe is a `bun -e` fetch of `/api/v1/readyz`), `restart: unless-stopped`.
  Verified: clean `docker compose up` → healthy → migrations applied → `readyz` 200.

```sh
docker compose up --build        # from the repo root
```

## Auth & sessions (M2 — D2, D3, D15, D16)

- **Token model (D2):** bearer-only. 15-minute HS256 access JWTs signed with
  `ARCDROP__JWT__SECRET` (claims: `sub`, `fam`, `iss=arcdrop`, `exp` — the algorithm
  is pinned on verify) + opaque 256-bit refresh tokens stored as sha256 hashes.
- **Rotation & reuse detection:** every refresh/claim/login mints a new refresh token
  inside a `familyId`; presenting an already-revoked token revokes the WHOLE family
  (device logged out everywhere). The revocation is committed BEFORE the 401 —
  throwing inside the rotation transaction would roll it back (bug we hit and fixed;
  `AuthService.refresh` uses an outcome pattern for exactly this reason).
- **A session IS a refresh family:** `GET /auth/sessions` groups `refresh_tokens` by
  `familyId` (deviceLabel, createdAt, lastUsedAt, `current` flag from the access
  token's `fam` claim, `revokedAt` for dead families).
- **Immediate revocation:** the global `JwtAuthGuard` loads the user from the DB on
  every request — a disabled user's unexpired tokens die on the next call. Disabling
  via the admin API additionally revokes all their refresh tokens.
- **Bootstrap (D3):** `POST /auth/bootstrap` creates the first admin and then refuses
  with 409 forever. `POST /auth/register` exists but 403s while the `registrationOpen`
  setting is off; `PUT /admin/settings` flips it live.
- **Invite/reset tokens (D15):** admin-created users get a single-use invite token
  (~24h); `POST /admin/users/{id}/reset-password` mints a reset token (~1h). Both are
  returned ONLY in the admin API response body (stored hashed; no SMTP). Newer tokens
  of the same type supersede unused older ones. `POST /auth/claim` consumes the token,
  sets the password, revokes the user's existing sessions and starts a new one.
- **Password change:** `POST /auth/password` revokes all OTHER families (the caller's
  survives via its `fam` claim).
- **Throttling:** `@nestjs/throttler` — global default 100 req/min per IP; every
  `/auth/*` route is capped at 10 req/min (the e2e suite proves a 429 problem+json on
  the 11th login in an isolated boot).
- **Guards (order matters):** `ThrottlerGuard` → `JwtAuthGuard` (global; `@Public()`
  opts out — health probes and the public auth routes use it) → `RolesGuard`
  (`@Roles('admin')` on `/admin/*`).
- **Instance settings (D16):** `settings` table, typed via `SettingsService` —
  `registrationOpen` (default false), `trashRetentionDays` (30), `changeLogRetentionDays`
  (90). Secrets/infra stay env-only.

## Module map (as of M2)

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
  auth/                    /auth/* controller+service; crypto (JWT/argon2/opaque tokens);
                           global guards (throttler, JWT, roles) + @Public/@Roles/@CurrentUser
  users/                   /admin/users controller+service (invite/reset tokens via API)
  settings/                SettingsService (typed DB settings) + /admin/settings
test/
  helpers.ts               e2e env bootstrap (only ARCDROP__DATABASE__URL must be preset)
  api-foundation.e2e.test.ts   full contract suite (two boots: default + metrics/CORS on)
  auth-users.e2e.test.ts       M2 lifecycle suite (main boot + isolated throttle boot)
```

Both `main.ts` and the e2e boots go through `app-setup.ts` — keep runtime behavior and
tests in lockstep by wiring new app-level concerns THERE.

## Decisions recorded (M2)

- **Password hashing: `@node-rs/argon2` (napi prebuilds, argon2id).** Verified on Bun
  1.4.2 (Windows dev + alpine musl in the compose image) before building on it; the
  bun bundler emits the `.node` binary as a dist asset, so production needs no
  compiler toolchain. OWASP-recommended parameters (m=19456, t=2, p=1) are pinned
  explicitly in `PasswordService`.
- **Access JWTs are hand-rolled on `node:crypto`** (`auth/crypto/jwt.service.ts`) —
  no JWT dependency; HS256 pinned on sign AND verify (an `alg: none`/HS512 header is
  rejected), `timingSafeEqual` signature checks, `iss`/`exp` enforced. Unit-tested
  including tamper/al/expiry cases.
- **`OneTimeToken` is a fourth entity** (the ticket lists three): single-use +
  expiring + type-discriminated (invite|reset) storage for D15 was cleaner than
  columns on `users` and keeps User minimal. Same hashed-at-rest discipline as
  refresh tokens.
- **Reuse-revocation must not throw inside its transaction** — the outcome pattern in
  `AuthService.refresh` commits the family revocation, then the handler throws the 401. (Throw-first version rolled the revocation back.)
- **Login failure timing is equalized:** unknown email runs one argon2 verify against
  a lazily-generated dummy hash, so "no such user" and "wrong password" cost the same.
  Both return the same generic 401; disabled accounts are indistinguishable too.
- **Last-admin guardrail:** the admin API refuses to demote/disable the last active
  admin (409) — an instance you can't unlock is worse than a strict rule.
- **`express-serve-static-core` augmentation:** `request.user` typing needs the
  module to be resolvable under Bun's isolated linker, so
  `@types/express-serve-static-core` is an explicit devDependency (already a
  transitive dep of `@types/express`).
- **Throttle budgets:** global 100/min; `/auth/*` 10/min per IP. Generous enough that
  a single client refreshing hourly never trips it, strict enough to matter for
  credential stuffing; the numbers are asserted in e2e.

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
- CI (`.github/workflows/ci.yml`) provisions a PostgreSQL **16** service container
  for the e2e job — same image as the compose bundle.
- M2 added `@nestjs/throttler@6` and `@node-rs/argon2@2` as runtime deps and
  `@types/express-serve-static-core` as a dev dep.
