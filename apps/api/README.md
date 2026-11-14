# ArcDrop API (`@arcdrop/api`)

NestJS REST API for ArcDrop — self-hosted, multi-user bookmark platform. Runs on Bun.

**Status:** M6 — metadata & icons (M1 foundation + first-run admin bootstrap,
bearer JWT auth with rotating refresh tokens and reuse detection, sessions,
admin user management with single-use invite/reset tokens, DB-backed instance
settings, route throttling; M3 bookmark CRUD with URL decomposition, tags,
server-side search/paging/stats, trash with auto-purge, and the per-user
change log; M4 hierarchical collections with the nested tree, membership
sync, cycle protection, ordering — all change-logged; M5 the sync backbone:
`/sync/state`, `/sync/changes` cursor deltas, the ws push gateway with
one-time tickets, and the change-log retention job; M6 the SSRF-hardened
metadata pipeline with the async enrichment on create/url-change, the
public unguessable icon cache + serve route, per-bookmark reindex, the
icon-eviction job and the backfill CLI). Next: M7 — MCP server.

The full build plan (M0–M9) covers: API foundation, auth & users, bookmarks core,
collections, sync, metadata & icons, MCP, portability, hardening & ops.

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
| `bun run backfill:metadata`  | Build, then backfill metadata/icons for pre-M6 bookmarks (see the M6 section) |

Repo-root scripts (`bun run dev`, `bun run lint`, `bun test`, …) proxy into this app.

## Environment

Config is validated with zod at boot (fail-fast: invalid env → report with the offending
`ARCDROP__*` names → exit 1). Prefix `ARCDROP__`, double-underscore nesting
(`ARCDROP__DATABASE__URL` → `database.url`). Unknown `ARCDROP__*` keys are rejected
(typo protection). Copy `.env.example` to `.env` for local dev — bun loads it
automatically.

| Variable                            | Required | Default | Meaning                                                  |
| ----------------------------------- | -------- | ------- | -------------------------------------------------------- |
| `ARCDROP__DATABASE__URL`            | yes      | —       | PostgreSQL connection URL (`postgres://…`)               |
| `ARCDROP__JWT__SECRET`              | yes      | —       | JWT signing secret, min 32 chars (used from M2)          |
| `ARCDROP__PORT`                     | no       | `3000`  | HTTP port                                                |
| `ARCDROP__CORS__ORIGINS`            | no       | empty   | Comma-separated browser origins; empty = CORS off        |
| `ARCDROP__DATA_DIR`                 | no       | `/data` | Data volume root (icons live in `…/icons` since M6); must be writable |
| `ARCDROP__METRICS__ENABLED`         | no       | `false` | Serve Prometheus metrics at `/metrics`                   |
| `ARCDROP__METADATA__ENABLED`        | no       | `true`  | M6 outbound metadata/icon fetch pipeline master switch   |
| `ARCDROP__METADATA__ALLOW_PRIVATE`  | no       | `false` | M6 TEST/DEV ONLY — let the fetcher target private/loopback initial urls (redirect hops stay strict). NEVER in production |
| `ARCDROP__LOG__LEVEL`               | no       | `info`  | pino level: `fatal…trace`                                |

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

## Metadata & icons (M6 — D18)

The enrichment pipeline turns a bare URL into title + description + cover +
icon, with the SSRF guard as a hard requirement (the fetcher is the security
boundary — treat it as such). Wave-2 M10 will extend it (content-type
detection); the pieces are separate collaborators on purpose:
`SsrfSafeFetchService` (transport) → `parsePageMetadata` (pure HTML parsing)
→ `IconCacheService` (storage) → `MetadataFetchService` (orchestration +
change-log write).

### The fetch pipeline

- **Triggers:** `POST /bookmarks` (mode `fill`) and a url-changing
  `PUT /bookmarks/{id}` (mode `refresh`) schedule enrichment AFTER the
  mutation's transaction commits — fire-and-forget, the HTTP response never
  waits, and every failure is swallowed (debug log only). The completion
  write goes through `ChangeLogService.transact` (its own transaction), so a
  successful fill records ONE `bookmark:update` event and the M5 ws push
  notifies every device. No-op fills record nothing; bookmarks that vanished
  or entered the trash meanwhile are skipped.
- **Fill semantics (the contract):** the pipeline fills ONLY fields that are
  still `null`. Client-provided title/excerpt are NEVER overwritten — the
  pipeline cannot distinguish its own earlier fill from client data, so
  text is fill-if-null in BOTH modes. To have a field re-filled: clear it
  with an explicit `null` (PUT), then `POST /bookmarks/{id}/reindex`.
- **Mode `refresh`** (url change, reindex) additionally REPLACES
  `coverRef`/`iconRef` on success — they are server-owned cache references
  for THE URL's page; after a url change they would point at the old site's
  images. The replaced files are orphaned and swept by the eviction job.
  Clients cannot set coverRef/iconRef (not in any DTO), so this never
  overwrites client data.
- **Per-field independence:** a broken og:image never sinks the favicon and
  vice versa; the title/description come from the same page fetch.
- **When `ARCDROP__METADATA__ENABLED=false`:** nothing schedules, nothing
  fetches; `reindex` still validates (404s) and answers `scheduled`, but the
  job no-ops. All existing-suite e2e boots run with it disabled (see
  `test/helpers.ts`) — a live pipeline would scrape real URLs mid-test and
  inject `bookmark:update` events that break exact-seq sync assertions.
- **Charset v1:** bodies decode as UTF-8 (`TextDecoder`); other charsets are
  mojibake'd. Known acceptable limitation, documented for M10.

### SSRF policy (hard requirement — do not weaken)

`SsrfSafeFetchService` gates EVERY fetch the pipeline makes (page, og:image,
favicon — an attacker-chosen og:image URL is itself an SSRF vector):

- **Resolve DNS first, connect only if every resolved address is public.**
  Blocked IPv4: `0.0.0.0/8`, `10/8`, `127/8`, `169.254/16` (incl.
  `169.254.169.254`), `172.16/12`, `192.168/16`. Blocked IPv6: `::1`, `::`,
  `fc00::/7`, `fe80::/10`, plus IPv4-mapped (`::ffff:0:0/96`) and the
  deprecated `::/96` compatible form (embedded IPv4 re-checked). Pure math
  in `src/metadata/private-ip.ts`, unit-tested as a matrix.
- **Fail closed:** unresolvable hostnames, empty answers and addresses that
  cannot be classified are refusals.
- **Every redirect hop is re-validated** against the same rules — scheme
  (http/https only), DNS resolution, private ranges. Redirects cap at 5;
  relative `Location` resolves against the current hop.
- **Caps:** one ~10 s deadline across the whole walk (DNS + hops + streamed
  body read share it; the final hop's abort timer stays armed while the body
  streams), ~2 MB body cap enforced on the `content-length` header AND the
  streamed read.
- **Content-type before bytes:** HTML allowlist (`text/html`,
  `application/xhtml+xml`) for pages; `image/*` for icons. Refused bodies
  are cancelled (an unread body pins a pooled socket and stalls the next
  fetch).
- Non-2xx responses are refused. The resolver and transport are injectable
  (`withDeps`) — that is what makes the private-range and
  redirect-to-private refusals unit-testable without a network; the e2e
  suite re-proves them over real HTTP against loopback stubs.
- **Known limitation (v1, accepted):** the OS resolves the hostname a second
  time for the actual TCP connection, so a theoretical DNS-rebinding window
  remains; resolve-then-connect is exactly the ticketed design. True pinning
  needs a custom dialer (Bun's fetch has no lookup hook) — revisit in M9
  hardening if ever.
- `ARCDROP__METADATA__ALLOW_PRIVATE=true` is a TEST/DEV affordance that
  relaxes ONLY the initial url (so stub servers on loopback work in e2e);
  redirect hops are ALWAYS strict because their target is attacker-chosen.
  Never enable it in production.

### Icon cache + public serving (D18)

- Files live under `ARCDROP__DATA_DIR/icons`; `bookmarks.cover_ref` /
  `bookmarks.icon_ref` store the FILE NAME (`Vx8…aQ.png`) as the ref. The id
  part is 24 random bytes → 32 base64url chars (192-bit, `node:crypto` —
  the nanoid-equivalent; no dependency).
- **The ref is the capability:** `GET /api/v1/icons/{id}` is PUBLIC,
  no auth (D18 — web `<img>` tags cannot send Authorization headers), served
  with the STORED content type (the file extension is the type record — no
  DB row involved), `Cache-Control: public, max-age=31536000, immutable`
  and `X-Content-Type-Options: nosniff`. Unknown/malformed refs are 404s;
  path traversal cannot escape (strict ref regex + containment check).
  Throttled at 300 req/min per IP (a gallery of covers would drown in the
  global 100/min).
- **Write-side allowlist:** png, jpeg, gif, webp, avif, x-icon,
  vnd.microsoft.icon — `image/svg+xml` is deliberately EXCLUDED (serving
  attacker-supplied SVG from the API origin is stored XSS: `<img>` can't run
  scripts but direct navigation can). Empty and >2 MB bodies refused.
- **Eviction:** `IconEvictionService.evictOrphaned()` deletes icon files no
  bookmark row references (referenced = ANY row's cover/icon ref, trash
  state irrelevant — a trashed bookmark may be restored). Only files whose
  names match the ref pattern are ever unlinked; foreign files survive.
  Runs daily at 05:00 (`IconEvictionJob`, staggered behind the 03:00 trash
  purge and 04:00 log retention so purge-orphans are swept the same night)
  and fire-and-forget after every trash purge (`TrashPurgeService`
  ride-along).

### Reindex + backfill

- `POST /bookmarks/{id}/reindex` — bearer-authed, owned + ACTIVE only
  (trashed/unknown → 404, same rules as PUT). Returns `202
  { id, status: "scheduled" }` immediately; the pipeline runs in `refresh`
  mode and its completion records the `bookmark:update` event.
- Backfill for pre-M6 rows is a CLI run IN THE CONTAINER:
  `docker compose exec api bun dist/scripts/backfill-metadata.js`
  (options: `--user=<uuid>`). Locally: `bun run backfill:metadata` (builds
  first). It reuses `MetadataFetchService.enrich` in `fill` mode over active
  rows missing any field, id-ordered in batches of 100 — re-runnable by
  construction. Exit 1 with a clear message when env is invalid or the
  pipeline is disabled; per-row failures are silent and tallied.

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
  except for restore — `replaceTags` used to predate that rule; M5
  aligned it). The response is the resulting membership set
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

## Sync integration (M5 — D4)

The change log is the multi-device sync backbone (plan D4: "change log +
cursor + ws push; ws messages are notifications, the REST delta is the
source of truth"). Single instance, in-process bus fan-out — Redis
scale-out is explicitly out of scope. All seqs are pg `bigint` and travel
as DECIMAL STRINGS everywhere (events, ws payloads, cursors) — never JS
numbers.

### REST surface

- **`GET /sync/state`** — `{ seq: "42" }`, the caller's current counter
  (`users.sync_seq`). The cheap poll: compare against your persisted cursor
  to decide whether pulling a delta is worth a round trip.
- **`GET /sync/changes?since=&limit=`** — the delta. `since` is the last seq
  the client holds ("I have everything ≤ since"; default `0`; decimal
  string, digits only, ≤ 19 digits, no leading zeros — garbage is a 400
  VALIDATION_FAILED problem+json). `limit` defaults to 100 and CLAMPS to
  200 above that (same discipline as bookmark paging). The response is
  `{ resyncRequired, changes, cursor }`:
  - `changes` are events IN SEQ ORDER (ascending, gapless per user — this
    is why a cursor alone reconstructs state even for multi-event
    mutations like tag merges, which arrive as `tag:delete` + one
    `bookmark:update` per affected bookmark). Each event is
    `{ seq, entity, id, action, snapshot }`.
  - `snapshot` is the entity's CURRENT row at PULL time: create/update
    carry a full row — bookmarks reuse `BookmarkDto` exactly (including
    `urlParts` and `tags`, via the same helper as the REST read paths),
    tags/collections have their own snapshot shapes — and `null` for
    `delete` tombstones (the row is gone; the event is the proof it died).
    A missing row on create/update is served as a tombstone too
    (defensively). Soft delete (trash) is NEVER a tombstone: the snapshot's
    `deletedAt` carries that state. Because snapshots are current rows,
    replaying in seq order converges even when an entity changed again
    later — later events' snapshots simply win.
  - `cursor` is the next cursor to persist: the last returned seq, or the
    request's `since` when the page is empty. Pull `since=<cursor>` for the
    next page; the notified seq is INCLUSIVE — a client holding cursor N
    pulls `since=N` to receive N+1….
  - **`resyncRequired: true`** means `since` predates the oldest retained
    event (log compaction ate the gap) or the cursor is beyond the counter
    (restored client state). The delta is WITHHELD — `changes` is empty and
    `cursor` is the current seq. The client must refetch its lists
    (`GET /bookmarks` incl. `trashed=true`, `GET /collections`) and adopt
    the returned cursor; it is fully converged again after that.
- **`POST /sync/ticket`** — mints `{ ticket, expiresAt }`: a 256-bit
  one-time credential for the ws handshake (browsers cannot send an
  `Authorization` header on websocket requests). Single use, 60-second
  TTL, sha256-hashed at rest.

### Change-log retention

`ChangeLogRetentionService.purgeExpired()` deletes `change_events` rows
older than the `changeLogRetentionDays` setting (default 90, min 1 via the
settings validation); `ChangeLogRetentionJob` runs it daily at 04:00
(staggered one hour behind the 03:00 trash purge). Failures are logged,
never raised. The purge does NOT touch `users.sync_seq` (cursors stay
valid absolute seqs), does NOT delete entity rows, and records NO events —
it is log bookkeeping, not a data mutation. Clients inside or after the
retained window keep pulling normally (`since+1 == oldest retained` is the
exact continuity boundary); clients behind it get `resyncRequired`.

### Websocket push — `/api/v1/sync/ws`

- **Adapter: raw `ws`** via `@nestjs/platform-ws` (pinned to v11 — v12
  requires Nest 12). Trade-off record: socket.io ships reconnection
  built-in but locks every desktop/mobile client into its proprietary
  protocol; raw `ws` is plain RFC 6455 that all four client platforms
  speak natively. Reconnect is a CLIENT concern (contract below), rooms
  are 30 lines of registry, and the payload stays inspectable. The gateway
  rides the same HTTP server as the REST surface; the ws path is fixed as
  `/api/v1/sync/ws` (ws gateways pass through neither the `api` prefix nor
  URI versioning, so the full path is hardcoded).
- **Auth: one-time ticket on the handshake query string**
  (`…/sync/ws?ticket=<from POST /sync/ticket>`). Redeemed atomically
  (single use even on the expiry path); missing/unknown/expired/replayed
  tickets are rejected with ws close code **1008** before the connection
  joins any room (`reason`: `sync ticket missing` /
  `sync ticket invalid, expired or already used`). The store is a plain
  in-memory Map: tickets are 60s-ephemeral by construction, a restart just
  costs one re-mint, and v1 is single-instance anyway.
- **Messages are notifications only:** each committed change is pushed to
  the owning user's connections as `{ seq, entity, id, action }` — no
  payload. On receipt the client pulls `GET /sync/changes?since=cursor`
  (the REST delta is the source of truth). Events reach the bus strictly
  after their transaction commits, so a ws client never hears about
  rolled-back work.
- **Rooms:** `ws` has no room concept; `SyncConnections` maps userId →
  sockets and fan-out touches ONLY the owner's connections — cross-user
  isolation is structural, not a filter.
- **Heartbeat:** server pings every 30s at the PROTOCOL level; browsers
  and `ws`-based clients answer pongs automatically (no client code). A
  connection missing its pong is terminated. The channel is push-only —
  client-sent frames are ignored.
- **Client contract (what every client app must implement):**
  1. `POST /sync/ticket` (bearer) → connect `?ticket=` → on message `{seq,
…}` → pull `/sync/changes?since=cursor` → persist the returned cursor
     → repeat until empty.
  2. On close: reconnect with exponential backoff, re-minting the ticket
     each attempt (a ticket is single-use; a stale one is refused 1008).
  3. After any reconnect — or after seeing `resyncRequired` — reconcile
     from the REST delta (or refetch lists on resync); never trust
     received notifications as the change itself.

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

## Module map (as of M6)

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
                           /bookmarks/{id}/reindex (schedules the M6 pipeline);
                           UrlDecompositionService (D12); TrashPurgeService + cron job
                           (purge now fires the icon-eviction ride-along)
  collections/             /collections flat list + tree + CRUD + restore + order;
                           cycle protection, two-phase delete, membership sync;
                           tree-builder.ts (pure, unit-tested)
  metadata/                M6: SsrfSafeFetchService (DNS-resolve-first guard, per-hop
                           re-validation, redirect/deadline/size/content-type caps);
                           html-metadata.ts (pure parser); IconCacheService (unguessable
                           refs on the data volume); /icons/{id} PUBLIC serve route (D18);
                           MetadataFetchService (async fill/refresh pipeline + reindex);
                           IconEvictionService + daily 05:00 job; private-ip.ts (pure
                           blocklist math)
  scripts/                 backfill-metadata.ts — CLI entry point (bundled to
                           dist/scripts/backfill-metadata.js; container workflow)
  sync/                    /sync/state + /sync/changes cursor deltas (snapshots at
                           pull time, resyncRequired contract); /sync/ticket
                           (one-time 60s ws tickets, in-memory store); ws gateway
                           (raw `ws` adapter, per-user rooms, protocol heartbeat);
                           change-log retention service + daily 04:00 job
test/
  helpers.ts               e2e env bootstrap (only ARCDROP__DATABASE__URL must be preset;
                           metadata pipeline DISABLED by default — see the M6 section)
  api-foundation.e2e.test.ts   full contract suite (two boots: default + metrics/CORS on)
  auth-users.e2e.test.ts       M2 lifecycle suite (main boot + isolated throttle boot)
  bookmarks.e2e.test.ts        M3 suite (lifecycle boot + isolated search/paging boot)
  collections.e2e.test.ts      M4 suite (lifecycle boot + isolated validation boot)
  metadata.e2e.test.ts         M6 suite (permissive boot: happy path, SSRF refusals incl.
                               redirect-to-private, oversized, content-type gates, public
                               icon fetch, reindex, url-change refresh, eviction + backfill;
                               strict boot: loopback refused at hop 0)
  sync.e2e.test.ts             M5 suite (ws convergence, offline catch-up,
                               resyncRequired, ticket paths, isolation, retention)
```

Both `main.ts` and the e2e boots go through `app-setup.ts` — keep runtime behavior and
tests in lockstep by wiring new app-level concerns THERE.

## Decisions recorded (M6)

- **The pipeline is disable-able and DEFAULTS OFF in every test boot.**
  `ARCDROP__METADATA__ENABLED` (default true in production) exists as a real
  operator knob AND the test seam: `test/helpers.ts` pins it to `false`, so
  no other suite scrapes real URLs mid-test or picks up extra
  `bookmark:update` events that would break the sync suite's exact-seq
  assertions. The metadata e2e flips it on for its own boots and restores
  the env in `afterAll` — bun runs all test files in one process, so env
  hygiene across files is load-bearing.
- **Text is fill-if-null everywhere; server-owned refs are the only
  refreshable fields.** The pipeline cannot distinguish its own earlier
  title fill from client data, so "never overwrite client-provided" forces
  fill-if-null for title/excerpt in BOTH modes. coverRef/iconRef, by
  contrast, are pure server artifacts for THE URL's page — `refresh` mode
  (url change, reindex) replaces them on success and the eviction job sweeps
  the orphans. The documented recipe to force a text re-fill: PUT an
  explicit `null`, then reindex.
- **`allowPrivate` relaxes only hop 0; redirect hops are ALWAYS strict.**
  The e2e stub servers live on loopback, so some boot must be allowed to
  fetch them — but a redirect target is attacker-chosen, so hop ≥ 1 keeps
  the full private-range validation even in permissive test boots. This is
  what makes the ticket's "public host redirects to a private address" case
  honestly testable over real HTTP (the stub plays the public host).
- **Icon refs are file names; the extension is the content-type record.**
  `GET /icons/{id}` is public (D18) and serves with no DB row involved — the
  strict ref regex maps the extension back to an exact media type. SVG is
  excluded from the write allowlist on purpose: attacker-supplied SVG served
  from the API origin is stored XSS. The id is 192 bits of `node:crypto`
  randomness (nanoid-equivalent, zero deps).
- **Eviction is pattern-scoped.** Only files matching the ref regex are
  evictable — foreign files dropped into `icons/` are never unlinked, and
  trashed bookmarks still count as references (they can be restored). The
  05:00 job is the safety net; the trash-purge ride-along just makes the
  common orphan case same-minute.
- **The SSRF guard is one component, unit-tested with injected transport.**
  `SsrfSafeFetchService` takes `dns.lookup`/`fetch` via `withDeps` (never via
  constructor params — Nest DI must stay single-dependency), so the whole
  refusal matrix (private ranges, mixed-answer rebinding, redirect-to-private,
  redirect cap, size caps, content-type gates, timeout) is provable without
  any network, and the e2e suite re-proves the same refusals over real HTTP.
- **Unread response bodies are cancelled on every refusal path.** Found in
  e2e: a refused body pins the pooled keep-alive socket and the NEXT fetch
  to the same origin stalls until its deadline. Cancel-before-throw is now
  part of the guard's contract.
- **No new runtime dependencies.** The icon ids are plain `node:crypto`, the
  HTML parsing is regex-based and lenient (a missed field beats a parser
  dependency that can crash on tag soup), and the IP math is hand-rolled and
  matrix-tested — same discipline as the hand-rolled JWTs (M2).

## Decisions recorded (M5)

- **The ws adapter is raw `ws` (`@nestjs/platform-ws`), not socket.io.**
  Socket.io ships reconnection built-in but locks desktop and mobile
  clients into its proprietary protocol; raw `ws` is RFC 6455 that
  browsers, Node/Bun and mobile stacks speak natively. Reconnection is a
  documented client concern, per-user "rooms" are the `SyncConnections`
  registry, and the push payload stays plain JSON. `@nestjs/websockets` +
  `@nestjs/platform-ws` are pinned to v11 (v12 requires Nest 12 — same
  reason `@nestjs/swagger` stays on 11); `ws@8` joined the build's
  `--external` list (its optional native deflate deps must not be
  bundled).
- **The delta's `snapshot` is the entity's CURRENT row at pull time,**
  never a payload frozen in the event: `change_events` rows carry no data
  by design, so `/sync/changes` re-reads entities — bookmarks serve the
  exact `BookmarkDto` (reusing `BookmarksService.tagsForBookmarks`, so
  every surface is byte-identical), `delete` events (and defensively,
  missing rows) serve `null` tombstones, and trash travels as
  `deletedAt`. Snapshots are batched: one query per entity type per page.
- **`resyncRequired` is exact, not heuristic.** With gapless per-user
  seqs, the first event a lagging client needs is `since+1` — so the rule
  is `since+1 < oldestRetainedSeq` (compaction ate needed events), plus
  two defensive cases: cursors beyond the counter, and "nothing retained
  but the client lags the tip". The boundary case `since+1 == minSeq` is
  served normally (e2e-proven). When resyncing, the delta is withheld
  (empty `changes`) and the response hands the client the current seq as
  its new cursor.
- **ws tickets live in memory, not in the database.** They are 60s,
  single-use, sha256-keyed (never stored raw); a restart costs a client
  one reconnect + re-mint, and adding a table/migration for data that
  must not outlive the process would be schema for nothing. Reuse-detection
  (the DB-backed one-time tokens of D15) is for 24h credentials, not
  60s ones.
- **Rejections close with ws code 1008 + a reason string.** The upgrade
  completes, then the gateway closes before any room membership — that is
  the only rejection mechanism browsers can actually observe on a ws
  handshake (they cannot read HTTP status codes of a failed upgrade).
  One code, two reasons: missing vs invalid/expired/replayed (over-earning
  distinctions would only help someone probing tickets).
- **Retention (04:00, staggered from the 03:00 trash purge) deletes only
  `change_events` rows.** `users.sync_seq` is untouched (cursors remain
  absolute seqs), entity rows are untouched (tombstone state lives on
  rows), and no events are recorded — log compaction is bookkeeping.
  Clients older than the window are handled by `resyncRequired`, which is
  exactly why compaction cannot break a live cursor.
- **`replaceTags` now refuses trashed bookmarks (404)** — the M4 ride-along:
  aligned with `PUT`/`DELETE` (M3) and the membership sync (M4). The trash
  is read-only except for restore; a trashed bookmark's tag set stays
  frozen until restore or purge. Verified with a new e2e assertion.
- **`GET /sync/changes` clamps `limit` to 200** and validates `since` as a
  canonical decimal string (≤ 19 digits, no leading zeros); a regex-valid
  cursor beyond the pg bigint ceiling short-circuits to `resyncRequired`
  BEFORE any SQL cast (no 500s from client-supplied cursors).

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
  rule and still accepts them; **M5 aligned it** (see the M5 decisions).
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
- M5 added `@nestjs/websockets@11`, `@nestjs/platform-ws@11` and `ws@8` as
  runtime deps (`ws` is `--external` in the build) and `@types/ws` as a dev
  dep.
- M6 added NO dependencies — the fetch guard, IP blocklist math, HTML
  parsing and icon ids are all stdlib (`node:dns`, `node:crypto`,
  `node:fs/promises`). The build gained a third entry point
  (`dist/scripts/backfill-metadata.js`); the Dockerfile copies `dist/`
  wholesale, so the container ships it without changes.
