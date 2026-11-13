# ArcDrop API (`@arcdrop/api`)

NestJS REST API for ArcDrop — self-hosted, multi-user bookmark platform. Runs on Bun.

**Status:** M4 — collections (M1 foundation + first-run admin bootstrap, bearer JWT
auth with rotating refresh tokens and reuse detection, sessions, admin user
management with single-use invite/reset tokens, DB-backed instance settings,
route throttling; M3 bookmark CRUD with URL decomposition, tags,
server-side search/paging/stats, trash with auto-purge, and the per-user
change log; M4 hierarchical collections with the nested tree, membership
sync, cycle protection, ordering — all change-logged). Next: M5 — sync
integration (`/sync/state`, `/sync/changes`, ws gateway).

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
  `User`, `RefreshToken`, `OneTimeToken` (M2 auth), `Setting` (D16 runtime settings),
  `Bookmark`, `Tag`, `BookmarkTag`, `BookmarkCollection`, `Collection`, `ChangeEvent`
  (M3/M4).
- `src/database/migrations/` — explicit migration list + the no-op
  `InitialSetup1763000000000` pipeline proof, `M2AuthUsers1794606603617`
  (users/refresh_tokens/one_time_tokens/settings + the three enum types),
  `M3BookmarksCore1794608754948` (bookmarks/tags/memberships/change_events +
  `users.sync_seq`) and `M4Collections1794611852359` (collections + the
  `bookmark_collections.collection_id` FK ON DELETE CASCADE + the `collection`
  value on the `change_entity` enum). M5 needs NO schema pending work —
  `users.sync_seq` and the bus are live and already see all three entity types.

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

## Bookmarks core (M3 — D4, D5, D10, D12, D13, D17)

- **URL decomposition (D12):** `UrlDecompositionService` parses with the WHATWG
  `URL` parser + `tldts` registrable domain. The `url` column stores the URL
  VERBATIM; `scheme/host/domain/port/path/query/fragment` are derived on every
  url write and never client-writable. `host` is hostname WITHOUT port; `port`
  is null when absent/scheme-default; `domain` is the lowercased PSL registrable
  domain (`www.example.co.uk` → `example.co.uk`, null for IP hosts);
  `query`/`fragment` drop their delimiters. Indexes: `(userId, domain)`,
  `(userId, host)`. The derived parts are also returned in every bookmark
  response as `urlParts` (handy for clients and tests).
- **Duplicates ALLOWED (D13):** no unique index on `(userId, url)`;
  `POST /bookmarks` ALWAYS inserts. No upsert on the create path (import in M8
  will be the only upsert-on-URL surface).
- **Trash is a PLAIN `deleted_at` column, NOT `@DeleteDateColumn`.** TypeORM's
  soft-delete magic silently appends `deleted_at IS NULL` to repository finds
  and query builders, which contradicts the explicit trash scoping this module
  needs (`trashed=true` lists, the retention purge). Every read states its
  trash scope explicitly: default lists/`total`/`unassigned` see active rows
  only, `trashed=true` lists see the trash, `GET /bookmarks/{id}` sees both
  (`deletedAt` in the body tells which). `PUT` and `DELETE` refuse trashed rows
  (404 among active); restore refuses active rows.
- **Search contract (D10):** `GET /bookmarks` with `search` (ILIKE across
  title/url/excerpt + tag names, LIKE metacharacters escaped),
  `tag` (exact, case-insensitive), `domain` (exact registrable domain,
  case-insensitive), `unassignedOnly`, `trashed`, `sort`
  (updated-desc default | created-desc | title-asc), `page` (≥1),
  `pageSize` (≥1, CLAMPED to 200 — a bigger value never 400s), `updatedSince`
  (ISO-8601, `updatedAt >`), and `collectionId` (uuid; membership filter,
  ACTIVE since M4 — see the collections section). Response: `{ items, totalCount, page,
pageSize }`; `totalCount` is pre-paging. Ordering is always
  `(sort, id ASC)` for stable paging. Tag names are attached to every item.
- **Tag invariants:** per-user case-insensitive unique names via a stored
  `name_lower` + unique `(userId, name_lower)` index; the first-created
  spelling wins as display name. A tag row exists ONLY while ≥1 membership
  references it — operations that detach the last membership (exact-set
  replacement, tag delete, merge, purge) prune it in the same transaction.
  `PUT /bookmarks/{id}/tags` replaces the exact set (missing tags created on
  demand); `PUT /tags/{name}` renames — or MERGES when another tag already
  holds the target name; `DELETE /tags/{name}` detaches everywhere.
- **Trash auto-purge (D17):** `TrashPurgeService.purgeExpired()` hard-deletes
  trashed bookmarks older than the `trashRetentionDays` setting (default 30,
  min 1 — the API clamps); `TrashPurgeJob` runs it daily at 03:00 via
  `@nestjs/schedule` (`ScheduleModule.forRoot()` in AppModule). The purge is
  one transaction, emits `bookmark:delete` tombstones + prunes newly orphaned
  tags; failures are logged, never raised.

### Change-log semantics (D4) — read before writing ANY mutation

- **Every data mutation goes through `ChangeLogService.transact`:**
  `transact(work)` opens the transaction, hands `work` a `(manager, record)`
  pair; every `record(userId, { entity, entityId, action })` atomically takes
  the user's next seq via `UPDATE users SET sync_seq = sync_seq + 1 …
RETURNING` (the row lock serializes concurrent writers → seqs are GAPLESS)
  and appends the `change_events` row IN THE SAME TRANSACTION as the mutation.
- **Bus notifications fire only AFTER commit** — `transact` collects events
  and publishes them on `ChangeEventBus` once the transaction resolves, so
  listeners (M5's ws gateway) never see rolled-back work. This is the same
  transaction-throw discipline as `AuthService.refresh` (outcome pattern).
- **Event vocabulary:** `entity ∈ {bookmark, tag, collection}`, `action ∈
{create, update, delete}`. A mutation records one event per AFFECTED entity:
  bookmark CRUD/trash/restore → `bookmark:*`; `PUT …/tags` → `bookmark:update`
  plus `tag:create` for each on-demand tag and `tag:delete` for each pruned
  tag; tag rename → `tag:update`; merge/delete → `tag:delete` + a
  `bookmark:update` for every bookmark whose membership changed; purge →
  `bookmark:delete` (+ `tag:delete` for pruned tags). `delete` is only ever a
  HARD delete (trash/restore are `update`s). Rows carry no payload — M5's
  `/sync/changes` re-reads entities and serves tombstones from these rows.
- `users.sync_seq` is bigint → TypeORM surfaces it as a string; seq values
  travel as decimal strings everywhere (events, bus payloads, sync cursor).
- **Raw `RETURNING` queries must go through `queryRows()`**
  (`src/database/query-rows.ts`): TypeORM 1.1.x on pg returns plain row arrays
  for SELECT/INSERT..RETURNING but `[rows, rowCount]` TUPLES for
  UPDATE/DELETE..RETURNING. `manager.query` does not normalize this;
  `queryRows` does. Do not destructure `manager.query` results directly.

## Collections (M4 — D4, D5)

- **Shape:** `Collection(userId, parentId self-FK CASCADE, title, icon,
color, order, timestamps, deletedAt-as-plain-column)`. All rows are
  user-scoped; a foreign row is a 404, never a 403. Reads state their trash
  scope explicitly (same plain-`deleted_at` discipline as bookmarks — NOT
  `@DeleteDateColumn`).
- **Hierarchy:** `POST /collections` creates a root (no `parentId`) or a
  child; the parent must be ACTIVE and owned (else 404). New rows APPEND to
  their sibling group: `order = MAX(order) + 1` over ACTIVE siblings. The
  create path records its ChangeEvent FIRST inside the transaction — the
  per-user seq lock serializes concurrent creates, so two parallel creates
  of the same parent can never compute the same `MAX(order)` slot.
- **Reads:** `GET /collections` (flat rows, grouped per parent — roots
  first — siblings ordered), `GET /collections/tree` (nested), and
  `GET /collections/{id}` (active only; trashed rows are 404 everywhere on
  the read path). One shared sibling comparator EVERYWHERE:
  `(order ASC, createdAt ASC, id ASC)` — `createdAt` because millisecond
  ties are real, `id` because determinism is a contract.
- **Tree contract:** ACTIVE rows only. `bookmarkCount` is DIRECT — active
  bookmarks with a membership in THAT node (a parent never adds its
  subtree's counts on; trashed bookmarks never count). A child whose parent
  is trashed (or missing) is PROMOTED to the root level so restored subtrees
  never disappear; the raw `parentId` is preserved on the node. The flat
  list keeps raw `parentId` values too. (A parent_id data cycle — impossible
  through the API — would be dropped from the tree, not looped over.)
- **Cycle protection:** `PUT /collections/{id}` with a new `parentId` walks
  UP the raw parent chain from the proposed parent; hitting the moved
  collection (or itself, for self-parent) is a `409` problem+json
  (`code: CONFLICT`). Moving under a TRASHED parent is a 404 (parent not
  found among active). `parentId: null` moves a collection to the root
  level; `parentId` equal to the current one is a no-op. PUT semantics:
  provided fields replace, `icon`/`color` accept explicit `null` to clear,
  `title` trims and refuses whitespace-only. PUT always records
  `collection:update` (even for a pure no-op) — same as bookmark PUT.
- **Delete is TWO-PHASE (do not "fix" this — orchestrator-ratified):**
  1. First call on an ACTIVE row = trash (soft delete,
     `collection:update`). Blocked `409` while ACTIVE child collections
     exist; `?cascade=trash` trashes the whole ACTIVE subtree — the row
     itself included, so a cascade on a leaf trashes its direct bookmarks
     too — plus every ACTIVE bookmark carried by that subtree (each trash
     records `bookmark:update`).
  2. Second call on the TRASHED row = HARD delete (`collection:delete`
     tombstone). Refuses while ANY direct child rows exist unless
     `?cascade=trash`, which sweeps the trashed descendant rows too — but
     ACTIVE descendants are ALWAYS refused, even with cascade (a restored
     child under a trashed parent blocks the sweep). Hard delete NEVER
     deletes bookmark rows: only their membership rows die, and every
     bookmark that lost one records `bookmark:update`. The FK CASCADE on
     `bookmark_collections.collection_id` would otherwise eat memberships
     silently — that's why affected bookmarks are collected BEFORE the rows
     go and recorded explicitly.
- **Restore:** `POST /collections/{id}/restore` restores EXACTLY ONE row.
  Cascade-trashed descendants and bookmarks stay in the trash until
  individually restored (`POST /bookmarks/{id}/restore` for bookmarks) or
  purged — predictable beats magic. Until the parent is restored too, the
  restored collection appears at the tree's root level (promotion).
  Restore refuses active rows (404) and records `collection:update`.
- **Ordering:** `PATCH /collections/order` with
  `{ items: [{ id, order }] }` — EXPLICIT positions (≥ 0), not a sequence:
  partial reorders are the real-world case and unspecified siblings keep
  their positions. All ids must be active + owned (404 otherwise); rows
  whose value does not change record no event. Duplicate ids in one payload
  → 400.
- **Membership (D5):** `PUT /bookmarks/{id}/collections` with
  `{ collectionIds: [] }` is an EXACT-SET sync — memberships are ensured for
  listed ids and removed for absent ones; a bookmark may live in several
  collections. Every listed id must be ACTIVE and owned (404 otherwise,
  dedupe first); trashed bookmarks are refused (the trash is read-only
  except for restore — note `replaceTags` in M3 predates that rule and does
  NOT refuse; left as-is). The response is the resulting membership set
  (`{ collections: [{ id, title }] }` — BookmarkDto deliberately stayed
  frozen from M3). Events: the bookmark's own `bookmark:update` (always,
  even for a no-op set) plus `collection:update` for each collection whose
  membership set actually changed.
- **`collectionId` filter (activated in M4):** pure membership — a bookmark
  lists iff a `bookmark_collections` row exists, REGARDLESS of the
  collection's own trash state (a trashed collection's memberships still
  resolve; trashed bookmarks are excluded by the normal trash scoping).
  `unassignedOnly` composes with it (`collectionId + unassignedOnly` =
  "in this collection AND unassigned" — practically always empty, but
  well-defined). Bookmark listing by a HARD-DELETED collection id returns
  whatever rows still point at it — none, since memberships die with the
  rows.
- **Events from M4:** `collection:create` (create), `collection:update`
  (rename, metadata, moves, trash, restore, reorder, membership-set change),
  `collection:delete` (hard delete ONLY — never for trash). The M4
  migration extended the `change_entity` PG enum with `collection`
  (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`; the down() swaps the enum type
  back because PG cannot drop enum values — it deletes `collection` rows
  from `change_events` first, so revert is dev-only).

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

## Module map (as of M4)

```
src/
  main.ts                  fail-fast boot: validate env → mkdir data dir → serve
  app.module.ts            root module (imports below + global problem+json filter
                           + ScheduleModule for the trash-purge cron)
  app-setup.ts             shared wiring: logger, versioning, pipes, CORS, docs, infra routes
  config/                  env loading + zod schema + typed AppConfigService (APP_CONFIG token)
  common/                  problem+json filter & codes, validation pipe factory
  logging/                 nestjs-pino (correlation ids, redaction)
  database/                TypeORM DataSource, entities/, migrations/, query-rows helper,
                           CLI datasource
  health/                  GET /api/v1/healthz (process), GET /api/v1/readyz (DB + data dir)
  metrics/                 prom-client registry; /metrics route only when enabled
  auth/                    /auth/* controller+service; crypto (JWT/argon2/opaque tokens);
                           global guards (throttler, JWT, roles) + @Public/@Roles/@CurrentUser
  users/                   /admin/users controller+service (invite/reset tokens via API)
  settings/                SettingsService (typed DB settings) + /admin/settings
  change-log/              ChangeLogService (transact + gapless seq) + ChangeEventBus
                           (in-process fan-out for M5's ws push)
  bookmarks/               /bookmarks CRUD + trash/restore + list/search/stats;
                           /bookmarks/{id}/tags; /tags/{name} rename/merge/delete;
                           /bookmarks/{id}/collections (delegates to CollectionsService);
                           UrlDecompositionService (D12); TrashPurgeService + cron job
  collections/             /collections flat list + tree + CRUD + restore + order;
                           cycle protection, two-phase delete, membership sync;
                           tree-builder.ts (pure, unit-tested)
test/
  helpers.ts               e2e env bootstrap (only ARCDROP__DATABASE__URL must be preset)
  api-foundation.e2e.test.ts   full contract suite (two boots: default + metrics/CORS on)
  auth-users.e2e.test.ts       M2 lifecycle suite (main boot + isolated throttle boot)
  bookmarks.e2e.test.ts        M3 suite (lifecycle boot + isolated search/paging boot)
  collections.e2e.test.ts      M4 suite (lifecycle boot + isolated validation boot)
```

Both `main.ts` and the e2e boots go through `app-setup.ts` — keep runtime behavior and
tests in lockstep by wiring new app-level concerns THERE.

## Decisions recorded (M4)

- **Delete is two-phase: soft (trash) on the first call, HARD on the second
  call** of the same id, with `collection:delete` tombstones reserved for
  the hard path (trash/restore are `update`s, exactly like bookmarks).
  Hard delete never sweeps ACTIVE descendants — even with `?cascade=trash`
  — and never deletes bookmark rows; memberships die and their owners
  record `bookmark:update`. Ratified with the orchestrator; implemented in
  `CollectionsService.delete` with explicit descendant collection (BFS via
  `queryRows`) instead of relying on the FK CASCADE, so events and rows
  always match.
- **`PATCH /collections/order` takes explicit `{ items: [{ id, order }] }`
  positions**, not an id sequence: partial reorders are the real case,
  unspecified siblings keep theirs, and changed rows are the only ones that
  record events.
- **`POST /collections/{id}/restore` restores exactly one row** — no
  cascade, documented on the route and here. Children of a trashed parent
  are root-promoted in the tree until the parent comes back, so restore is
  order-independent.
- **Tree counts are DIRECT and active-only.** A node's `bookmarkCount` is
  the number of ACTIVE bookmarks carrying a membership in that node — no
  subtree rollup. Clients can sum recursively if they want totals; the
  reverse is impossible. One grouped `COUNT(*)` query feeds list/tree/get.
- **One sibling comparator everywhere** — `(order, createdAt, id)` — in the
  tree builder (`src/collections/tree-builder.ts`, pure and unit-tested)
  and the flat list's per-parent grouping. Create appends via
  `MAX(order) + 1` over ACTIVE siblings, computed INSIDE the transaction
  AFTER the `record()` call: the seq UPDATE's row lock serializes per-user
  writers, which is what makes concurrent sibling creates race-free.
- **Membership sync refuses trashed bookmarks** (404 among active) — the
  trash is read-only except for restore. M3's `replaceTags` predates this
  rule and still accepts them; left untouched to avoid a behavior change
  outside this milestone's scope (M5 may want to align it).
- **`GET /bookmarks?collectionId=` is a PURE membership filter** since M4:
  collection trash state is irrelevant, trashed bookmarks are excluded by
  the normal trash scoping, and it composes with `unassignedOnly` (AND).
- **The `change_entity` enum grew `collection`** via
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS` inside the migration transaction
  (PG 12+ allows it when the value is not used in the same transaction —
  the migration is schema-only). `down()` cannot drop the value (PG
  limitation) and instead swaps the enum type, deleting `collection`-typed
  change_events first — revert is a dev-only operation.
- **`PUT /collections/{id}` always records `collection:update`**, even for
  no-op payloads — PUT symmetry with bookmarks; clients derive "something
  may have changed" from the event alone.

## Decisions recorded (M3)

- **Change-log is transactional and gapless by construction:** seq from an
  atomic `users.sync_seq` increment inside the mutation's transaction; the
  row lock on the user row serializes concurrent writers (proven by a
  concurrent-create e2e with a gapless-seq assertion). Bus emission happens
  strictly after commit (see "Change-log semantics" above for the full
  contract every later milestone builds on).
- **`deleted_at` is a plain column, not `@DeleteDateColumn`** — TypeORM's
  automatic soft-delete filtering contradicted explicit trash scoping (found
  empirically: `trashed=true` queries returned nothing and the purge's
  `find({deletedAt: LessThan(...)})` silently matched zero rows). Every trash
  scope is stated explicitly in SQL now.
- **TypeORM 1.1.x pg `RETURNING` shape is not uniform** — SELECT and
  INSERT..RETURNING return row arrays; UPDATE/DELETE..RETURNING return
  `[rows, rowCount]` tuples. All raw queries go through `queryRows()`
  (`src/database/query-rows.ts`), unit-tested in `query-rows.test.ts`.
- **`PUT /bookmarks/{id}`/`DELETE` refuse trashed bookmarks (404); `GET` by id
  returns both states** (`deletedAt` in the body). Restore refuses active
  rows. Predictable one-way trash flow; no implicit resurrection.
- **Create has no `tags` field** — the tag set is managed exclusively by
  `PUT /bookmarks/{id}/tags` (exact replacement). Keep it that way so the
  validation whitelist never silently drops tag payloads on create.
- **`pageSize` clamps instead of rejecting**: `>200` → 200, garbage → 400.
  `totalCount` is always pre-paging. Ordering always ends `id ASC` so pages
  are deterministic even under equal `updatedAt` (millisecond ties are real).
- **Retention is API-clamped to ≥1 day** (`SettingsDto` @Min(1)), so the e2e
  purge test uses a 1-day window + backdated `deleted_at` instead of 0 —
  the same approach M5 will need for change-log retention tests.
- **Multi-entity mutations record multiple events** (e.g. a tag merge emits
  `tag:delete` + one `bookmark:update` per affected bookmark) — this is what
  lets M5 sync clients converge from the cursor alone. Single-entity
  mutations (create/update/trash/restore) record EXACTLY one event.
- **`tldts` 7 + `@nestjs/schedule` 6** added as runtime deps (pure JS, Bun
  verified); `ScheduleModule.forRoot()` lives in AppModule.

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
