# ArcDrop API (`@arcdrop/api`)

NestJS REST API for ArcDrop — self-hosted, multi-user bookmark platform. Runs on Bun.

**Status:** M16 — Manual ordering (**Wave 2: M0–M16**). Includes foundation + fail-fast config + health/ready/metrics/OpenAPI; bearer JWT auth with rotating refresh tokens, sessions, invite/reset tokens, DB settings, throttling; bookmarks core with URL decomposition, tags, search/paging, trash + auto-purge, and gapless change log; hierarchical collections; `/sync/state`, `/sync/changes`, ws push + tickets, and retention compaction; SSRF-hardened metadata pipeline + content-type classification + icon cache + reindex/eviction/backfill; PATs, MCP server at `/api/v1/mcp` (40 DTO-parity tools), and audit log; portability export/import across JSON/CSV/HTML/TXT/ENEX/ZIP with persisted highlights; M9 hardening & ops; M10 highlights (`D6`) CRUD + sync snapshots, favorites + `stats.favorites`, content-type detection (`article|image|video|audio|document|book|link`) + `type=` filter, and quick-add query params; M11 Raindrop-grade search operator grammar (`search`/`q`, field-scoped/tag/metadata/date/OR/exclusion operators, and reserved-operator 400 contract); M12 library health (normalized-URL duplicates finder + transactional resolve, scheduled SSRF-safe broken-links checker with `off|basic|default|strict` modes, `broken=` filter + `broken:` operator activation); M13 transactional bulk operations (`POST /bookmarks/bulk`, `POST /collections/merge`, `POST /collections/sort-alphabetical`, `POST /collections/delete-empty`) with shared REST/MCP `bulk` rate limit; plus M14 per-bookmark one-time reminders (`reminderAt`/`remindedAt`, `reminder=` filter + `reminder:` search operator) with WS-only live delivery (`D20`), `NotificationOutbox` persistence, and offline inbox (`GET /notifications`, `POST /notifications/read`); plus M15 TOTP 2FA with single-use recovery codes, two-step login (`TOTP_REQUIRED`), password-confirmed `POST /me/reset-data` & `DELETE /me`, and documented export→import account transfer; plus M16 membership-scoped manual bookmark ordering (`bookmark_collections.order`, `PATCH /collections/{id}/bookmarks/order`, `GET /bookmarks?sort=manual&collectionId=`). **Next:** Wave 2 — M17 (archive & full-text search).

The full build plan (M0–M9) covers: API foundation, auth & users, bookmarks core,
collections, sync, metadata & icons, MCP, portability, hardening & ops.

## Scripts

| Script                       | What it does                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `bun run dev`                | Watch-mode dev server (needs env vars, see below)                             |
| `bun run build`              | Bundle to `dist/` (`main.js` + `database/data-source.cli.js`)                 |
| `bun run start`              | Run the built bundle                                                          |
| `bun run lint`               | ESLint (repo-root flat config)                                                |
| `bun run typecheck`          | Strict TypeScript check (`tsc --noEmit`)                                      |
| `bun test src`               | Unit tests (`bun test`)                                                       |
| `bun test e2e`               | E2E tests (need `ARCDROP__DATABASE__URL`)                                     |
| `bun run migration:run`      | Build, then run pending migrations via the TypeORM CLI                        |
| `bun run migration:revert`   | Build, then revert the last migration                                         |
| `bun run migration:generate` | Build, then generate a migration (see Migration workflow)                     |
| `bun run backfill:metadata`  | Build, then backfill metadata/icons for pre-M6 bookmarks (see the M6 section) |
| `bun run load:smoke`         | Run M9 scripted rate-limit & correlation smoke test against a live server     |

Repo-root scripts (`bun run dev`, `bun run lint`, `bun test`, …) proxy into this app.

## Environment

Config is validated with zod at boot (fail-fast: invalid env → report with the offending
`ARCDROP__*` names → exit 1). Prefix `ARCDROP__`, double-underscore nesting
(`ARCDROP__DATABASE__URL` → `database.url`). Unknown `ARCDROP__*` keys are rejected
(typo protection). Copy `.env.example` to `.env` for local dev — bun loads it
automatically.

| Variable                                     | Required | Default     | Meaning                                                                                                                  |
| -------------------------------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ARCDROP__DATABASE__URL`                     | yes      | —           | PostgreSQL connection URL (`postgres://…`)                                                                               |
| `ARCDROP__JWT__SECRET`                       | yes      | —           | JWT signing secret & TOTP secret encryption key seed, min 32 chars (M2; M15 AES-256-GCM)                                 |
| `ARCDROP__PORT`                              | no       | `3000`      | HTTP port                                                                                                                |
| `ARCDROP__CORS__ORIGINS`                     | no       | empty       | Comma-separated browser origins; empty = CORS off                                                                        |
| `ARCDROP__DATA_DIR`                          | no       | `/data`     | Data volume root (icons live in `…/icons` since M6); must be writable                                                    |
| `ARCDROP__METRICS__ENABLED`                  | no       | `false`     | Serve Prometheus metrics at `/metrics`                                                                                   |
| `ARCDROP__METADATA__ENABLED`                 | no       | `true`      | M6 outbound metadata/icon fetch pipeline master switch                                                                   |
| `ARCDROP__METADATA__ALLOW_PRIVATE`           | no       | `false`     | M6 TEST/DEV ONLY — let the fetcher target private/loopback initial urls (redirect hops stay strict). NEVER in production |
| `ARCDROP__MCP__PAT_REQUESTS_PER_MINUTE`      | no       | `300`       | M7 per-PAT request budget per minute (REST + MCP combined)                                                               |
| `ARCDROP__PORTABILITY__IMPORT_MAX_BYTES`     | no       | `26214400`  | M8 import cap per uploaded file (25 MiB); larger uploads are a `413` problem+json                                        |
| `ARCDROP__PORTABILITY__IMPORT_ZIP_MAX_BYTES` | no       | `314572800` | M8 import cap for ZIP uploads (300 MB — archives unpack to many files)                                                   |
| `ARCDROP__LOG__LEVEL`                        | no       | `info`      | pino level: `fatal…trace`                                                                                                |

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
- **Errors (D9):** every REST error is RFC 7807 `application/problem+json`
  (`charset=utf-8`) with `type`, `title`, `status`, machine-readable `code`, human
  `detail`, plus `instance` and `requestId` extensions. Validation failures are `400`
  with `code: VALIDATION_FAILED` and per-field `errors: [{field, messages}]`.
  Stable code map lives in `src/common/problem-json/problem-codes.ts` — add new
  statuses there, never inline codes in features. EXCEPTION: the MCP endpoint
  (`/api/v1/mcp`) speaks JSON-RPC per the MCP transport spec — its HTTP-level
  errors are JSON-RPC error objects (401 is still an HTTP status from the guard),
  and tool-level failures are `CallToolResult { isError: true }`, not problem+json.
- **Correlation:** request id = incoming `x-request-id` (or a minted UUID), echoed on
  every response and attached to request logs, error logs, and problem bodies.
- **Body limits:** global REST JSON bodies are capped at **256 KB** (`413 PAYLOAD_TOO_LARGE` `application/problem+json`, with malformed JSON mapped to `400 BAD_REQUEST`); `/api/v1/mcp` is route-scoped to **2 MB** for base64 MCP `importData` payloads; multipart uploads on `POST /api/v1/data/import` enforce streaming `ARCDROP__PORTABILITY__IMPORT*_MAX_BYTES`.
- **Docs:** OpenAPI 3 at `/openapi.json` (enriched with `ProblemDetailsDto` schemas and `application/problem+json` error examples across all routes), Scalar UI at `/docs` (the UI bundle comes
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
  `User`, `RefreshToken`, `OneTimeToken`, `PersonalAccessToken` (M7 agent auth),
  `Setting` (D16 runtime settings), `AuditLogEntry` (M7 tool-call audit),
  `Bookmark`, `Highlight` (M10 / D6), `Tag`, `BookmarkTag`, `BookmarkCollection`,
  `Collection`, `ChangeEvent` (M3/M4/M10), `NotificationOutbox` (M14 / D20),
  `TfaRecoveryCode` (M15 single-use 2FA recovery codes).
- `src/database/migrations/` — explicit migration list + the no-op
  `InitialSetup1763000000000` pipeline proof, `M2AuthUsers1794606603617`
  (users/refresh_tokens/one_time_tokens/settings + the three enum types),
  `M3BookmarksCore1794608754948` (bookmarks/tags/memberships/change_events +
  `users.sync_seq`), `M4Collections1794611852359` (collections + the
  `bookmark_collections.collection_id` FK ON DELETE CASCADE + the `collection`
  value on the `change_entity` enum), `M7TokensAudit1794619559850`
  (personal_access_tokens + audit_log_entries),
  `M10BookmarkEnrichment1794626882385` (`highlights` table, `bookmarks.favorite`,
  `bookmark_content_type` enum + `bookmarks.content_type`, and `'highlight'` on
  `change_entity`), `M12LibraryHealth1794629705566` (`bookmarks.last_checked_at`,
  `bookmarks.broken_reason`, `bookmarks.broken_at`, and `IX_bookmarks_user_broken_at`),
  `M14RemindersNotifications1794632472998` (`bookmarks.reminder_at`,
  `bookmarks.reminded_at`, `IX_bookmarks_user_reminder_at`,
  `IX_bookmarks_reminder_due`, `notification_outbox`, and `notification_type` enum),
  `M15TwoFactorAuth1794633718696` (`tfa_recovery_codes`, `users.totp_enabled`,
  `users.totp_secret`, and `'tfa_challenge'` on `one_time_token_type`),
  and `M16ManualOrdering1794634989570` (`bookmark_collections.order` nullable
  integer `DEFAULT 0` + `IX_bookmark_collections_collection_order`).
  M5/M6/M8/M9/M11/M13 needed NO schema work.

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

Compose is hardened for self-hosting (M9): resource limits/reservations (`api`: 1G/1.0 CPU, `db`: 512M/1.0 CPU), `no-new-privileges:true`, graceful stop periods, JSON log rotation (`10m` x 5), and healthchecks on both services. Production backup, restore, upgrade, and Caddy/Nginx TLS reverse-proxy guides live in [`docs/backup-restore.md`](docs/backup-restore.md).

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
- **Search contract (D10 / M11):** `GET /bookmarks` with `search` (or alias `q`,
  rejecting requests that pass both with `400`) parsed through the M11
  operator grammar (see **Search operators (M11)** below — a single bare term
  remains the degenerate case: ILIKE across `title`/`excerpt`/`note`/`url` +
  tag names with LIKE metacharacters escaped), composing via `AND` with
  `tag` (exact, case-insensitive), `domain` (exact registrable domain,
  case-insensitive), `favorite` (`true`/`false`), `type` (`ContentType`),
  `unassignedOnly`, `trashed`, `sort` (updated-desc default | created-desc |
  title-asc | manual-asc (M16, requires `collectionId`)), `page` (≥1), `pageSize` (≥1, CLAMPED to 200 — a bigger value
  never 400s), `updatedSince` (ISO-8601, `updatedAt >`), and `collectionId`
  (uuid; membership filter, ACTIVE since M4 — see the collections section).
  Response: `{ items, totalCount, page, pageSize }`; `totalCount` is
  pre-paging. Ordering is always `(sort, id ASC)` for stable paging. Tag names
  are attached to every item.
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

## Metadata, icons & content types (M6 / M10 — D18, D19)

The enrichment pipeline turns a bare URL into title + description + cover +
icon + `contentType`, with the SSRF guard as a hard requirement (the fetcher is
the security boundary — treat it as such). The pieces are separate collaborators:
`SsrfSafeFetchService` (transport) → `parsePageMetadata` (pure HTML parsing) +
`classifyContentType` (pure M10 classifier) → `IconCacheService` (storage) →
`MetadataFetchService` (orchestration + change-log write).

### Content-type detection precedence (M10)

`Bookmark.contentType` (`article | image | video | audio | document | book | link`,
default `'link'`) is classified asynchronously by `MetadataFetchService` using
`classifyContentType` (`src/metadata/content-type.ts`) in strict precedence:

1. **Response `Content-Type` header:** `image/*` → `image`, `video/*` → `video`,
   `audio/*` → `audio`, EPUB/Mobi/AZW → `book`, PDF/Office/Markdown/RTF/CSV →
   `document` (HTML falls through).
2. **HTML `<meta property="og:type">`:** `article*`/`blog`/`news` → `article`,
   `video*` → `video`, `music*`/`audio*` → `audio`, `book*` → `book`, `image*` →
   `image` (`website` falls through).
3. **URL pathname file extension:** media/book/document extensions (`.png`,
   `.mp4`, `.mp3`, `.epub`, `.pdf`, etc.).
4. **Known host patterns (www-stripped):** video (`youtube.com`, `youtu.be`,
   `vimeo.com`, `twitch.tv`, `dailymotion.com`, `tiktok.com`), audio
   (`open.spotify.com`, `podcasts.apple.com`, `soundcloud.com`,
   `music.youtube.com`, `*.bandcamp.com`), image (`imgur.com`, `giphy.com`,
   `unsplash.com`, `flickr.com`), book (`goodreads.com`, `openlibrary.org`,
   `standardebooks.org`, `gutenberg.org`), article (`medium.com`, `*.medium.com`,
   `substack.com`, `*.substack.com`, `dev.to`).
5. **Fallback:** `'link'`.

On `fill` (create/backfill), `contentType` updates when still `'link'`; on
`refresh` (URL change / `POST /bookmarks/{id}/reindex`), `contentType` is
always re-evaluated. Hard SSRF/policy refusals abort without touching the row;
transient HTTP/DNS/network errors fall back to URL extension + host patterns.

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

## MCP server & personal access tokens (M7 — D23)

ArcDrop makes NO outbound AI calls (D23 — the AI-provider integration was
removed from the plan): external agents BRING the models and connect to the
API-hosted MCP server. An agent is just another client — every tool call runs
through the SAME services as REST: identical DTO validation, identical user
scoping, identical change-log writes, so M5 ws push converges devices AND
agents. The SDK gate was run FIRST (like M1's Bun gate):
`@modelcontextprotocol/sdk@1.32.2` verified on Bun 1.4.2 through the exact
production path (Express + `StreamableHTTPServerTransport`, stateful
`Mcp-Session-Id` sessions, SSE responses, DELETE teardown, plus the SDK's own
client transport end-to-end) — result recorded here and regression-covered by
the e2e suite.

### Personal access tokens (PATs)

- **What they are:** the auth path for clients that cannot run the refresh
  flow (Claude/Cursor/ChatGPT connectors, CI jobs). Long-lived (no expiry —
  revocation is the lifecycle), labeled, revocable, hashed at rest
  (sha256; same discipline as refresh/one-time tokens). Format:
  `arcdrop_pat_` + 43 base64url chars (256-bit CSPRNG) — the prefix makes a
  bearer token unambiguously a PAT against access JWTs and leak-scannable.
- **Routes:** `POST /me/tokens {name, readOnly?}` → `201` with the RAW token
  shown EXACTLY ONCE (only the hash is stored — lose it, mint a new one);
  `GET /me/tokens` (id, name, readOnly, createdAt, lastUsedAt, revokedAt —
  never the token); `DELETE /me/tokens/{id}` → `204` (idempotent stamp of
  `revokedAt`; a revoked token is a 401 on the very next request because the
  guard resolves the principal per request). OperationIds:
  `createPersonalAccessToken`, `listPersonalAccessTokens`,
  `revokePersonalAccessToken`.
- **`readOnly` scope:** at the REST level, read-only PATs may only use
  HTTP-safe methods — every POST/PUT/PATCH/DELETE is a `403` problem+json at
  the `PatScopeGuard` (mutation refusal never depends on route handlers). On
  the MCP endpoint (where EVERY tool call is an HTTP POST) the guard defers
  via `@PatScopeDeferred()` and the MCP layer refuses each mutation TOOL
  individually with a spec-compliant `isError` tool result — read tools run
  normally. The tool/REST classification can never disagree: both derive
  from the mirrored operation's REST method.
- **Surface rules for ALL PATs** (guard-level, even for an admin's own
  token): `/auth/*` is unreachable (a PAT is a credential, not a session —
  it must never rotate, claim, list, or change sessions) and `/admin/*` is
  unreachable (admin tooling stays session-only). Both are `403`s keyed off
  controller metadata, not path sniffing.
- **Per-PAT rate budget:** `ARCDROP__MCP__PAT_REQUESTS_PER_MINUTE`
  (default 300/min) counts REST + MCP requests per token. It is
  deliberately ABOVE the global per-IP budget (100/min) so it only bites
  when ONE token is used from MANY addresses — the stolen-token scenario
  the per-IP limit cannot see. Excess is `429` TOO_MANY_REQUESTS;
  in-memory fixed window (single-instance posture, same as the ws tickets).
- **Principal tagging:** PAT requests carry `authKind: 'pat'`, `patId` and
  `patReadOnly` on `request.user` (`fam` holds the patId — meaningless
  there because auth routes are unreachable); request logs keep the
  `authorization` header redacted.
- **NOT mirrored as MCP tools on purpose:** `/me/tokens` itself (a PAT must
  not mint credentials) — same rationale as the `/auth` + `/admin` refusals.

### The MCP endpoint

- **Transport:** `POST/GET/DELETE /api/v1/mcp` — Streamable HTTP per the
  current MCP spec (JSON-RPC over POST with optional SSE responses; GET
  opens the server-push stream; DELETE closes the session, `202`-family
  answer). Official `@modelcontextprotocol/sdk` (`StreamableHTTPServerTransport`).
  Sessions are stateful: `initialize` (no session id) → response carries
  `Mcp-Session-Id` → every later request MUST carry it (else `400`
  JSON-RPC error); unknown/foreign ids are `404` — a session is BOUND to
  the credential that created it (same user AND same token), so a leaked
  session id is useless without the bearer credential. Sessions live in
  memory (single-instance posture; restart ⇒ clients re-initialize), capped
  at 1000 (`503` above).
- **The endpoint is NOT problem+json:** it speaks JSON-RPC (protocol errors
  `-32602` invalid params / unknown tool, `-32000`/`-32001` session errors).
  Domain failures (unknown bookmark, collection-conflict…) are NOT protocol
  errors — they are `CallToolResult { isError: true }` with a human text
  summary, which is what agents actually act on.
- **Auth:** the normal global guard chain runs (Throttler → JWT-or-PAT →
  PAT scope → roles). Anonymous `initialize` is a `401`. The per-PAT rate
  budget applies to MCP traffic too.
- **Implementation shape:** one low-level SDK `Server` per session with the
  `tools` capability; the request principal rides `AsyncLocalStorage`, so
  concurrent calls on one session can never cross credentials; `dist/`
  keeps the SDK external (`--external '@modelcontextprotocol/*'` +
  `class-validator-jsonschema`) — same discipline as `ws` in M5.

### Tool catalog — the mirror convention

**Every tool name IS a REST `operationId`; every input schema is GENERATED
from the same class-validator DTOs the REST route validates
(`validationMetadatasToSchemas`); every call dispatches into the same
service method with DTO-instances built by the same `plainToInstance`
transform and validated with the same class-validator options as the global
pipe. Schemas cannot drift from validation because they ARE the validation
metadata; a unit test re-derives the schemas and the e2e suite asserts
`tools/list` byte-parity plus bidirectional operationId coverage against
the live `/openapi.json`.** Unknown extra arguments are stripped exactly
like extra REST JSON bodies (DTO whitelist), never errors.

- **v1 + M10–M16 catalog (40 tools):** bookmarks `listBookmarks` (incl. M11/M12/M14
  `search`/`q` operator grammar, `favorite`, `type`, `broken`, and `reminder` filters + broken/reminder fields), `getBookmark`, `createBookmark`, `updateBookmark` (incl.
  `favorite` toggle & `reminderAt`), `deleteBookmark` (trash), `restoreBookmark`,
  `bulkBookmarks` (M13: move/addTags/removeTags/trash/restore/delete),
  `replaceBookmarkTags`, `replaceBookmarkCollections` (membership sync),
  `reindexBookmark`, `getBookmarkStats` (incl. `favorites`),
  `listBookmarkTags`; highlights (M10 / D6) `listHighlights`, `createHighlight`,
  `updateHighlight`, `deleteHighlight`; collections `listCollections`,
  `getCollectionTree`, `getCollection`, `createCollection`, `updateCollection`,
  `deleteCollection` (two-phase like REST), `restoreCollection`,
  `reorderCollections`, `reorderCollectionBookmarks` (M16), `mergeCollections`, `sortCollectionsAlphabetical`,
  `deleteEmptyCollections` (M13); tags `renameTag` (renames or MERGES, like
  `PUT /tags/{name}`), `deleteTag`; sync `getSyncState`, `listSyncChanges`,
  `createSyncTicket` (ws push — an agent can watch the library the same way a
  device does); portability (M8/M10) `exportData`, `importData`,
  `exportBookmarkHighlights`; library health (M12) `findDuplicates`,
  `resolveDuplicates`; notifications (M14) `listNotifications`,
  `markNotificationsRead`. Tools return
  `structuredContent` (the exact service result; void operations return a
  bare `ok`) plus the same JSON as readable text content. Annotations carry
  `readOnlyHint` (derived from the REST method) and `idempotentHint`.
  Portability specifics: `exportData` (POST at REST → mutation-classified,
  same as `createSyncTicket` — read-only agents use the list/changes reads
  instead) answers json as structuredContent and csv/html/txt as the
  document text; `importData` takes base64 `data` + explicit `format`,
  decoded cap **1 MiB** — bigger uploads (25 MiB file / 300 MB zip) belong
  to REST; the JSON body limit is **2 MB** (see `setupApp`) exactly so this
  tool's envelope fits.
- **THE CONVENTION FOR FUTURE MILESTONES: new authenticated, non-admin REST
  surface ⇒ add the matching tool(s) in `src/mcp/mcp-tool-catalog.ts` and
  extend the e2e parity set. The e2e parity test FAILS the build when a
  covered REST operation has no tool or a tool has no REST operation —
  the catalog cannot silently rot.**
- **Worked example — highlights (landed in M10):** `GET/POST
/bookmarks/{id}/highlights` and `PUT/DELETE /highlights/{id}` landed in M10
  alongside `listHighlights`, `createHighlight`, `updateHighlight`, and
  `deleteHighlight` in the catalog (names from operationIds, schemas from DTOs,
  dispatched to `HighlightsService`), and `listBookmarks`/`updateBookmark`
  automatically picked up `favorite` and `type` from their DTO metadata.

### Tool-call audit (M9 reads this)

Every `tools/call` writes one `audit_log_entries` row — success AND failure
(unknown tool, bad arguments, read-only refusal, service error): actor
(`userId` + `actorType` + `patId`), `action` (v1 always `mcp.tools.call`),
`subject` (tool name), `outcome`, `detail` (arguments + failure reason),
`requestId`. Writes are fire-and-forget and can never fail a tool call.
There are deliberately NO foreign keys on the audit table — an audit trail
must outlive the actor rows it describes. The M9 admin surface is expected
to build the read side on this exact shape.

### Connecting real agents

Pat auth: mint a token (`POST /me/tokens`), paste it where the client asks
for an API key/header. Both clients below speak Streamable HTTP natively;
ArcDrop's server answers `initialize` → `tools/list` → `tools/call` over
`/api/v1/mcp`.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "arcdrop": {
      "url": "https://arcdrop.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer arcdrop_pat_…" }
    }
  }
}
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "arcdrop": {
      "url": "https://arcdrop.example.com/api/v1/mcp",
      "headers": { "Authorization": "Bearer arcdrop_pat_…" }
    }
  }
}
```

Notes: use a read-only token for exploratory assistants and a read-write
token only when the agent should actually organize the library; tokens are
revocable from `DELETE /me/tokens/{id}` (or the web client once it ships
the surface) without touching device sessions.

## Portability (M8 — D13, Raindrop parity G3/G4)

Data in and out, user-scoped. **The ACTIVE library only, by design:** the
trash is not exported and not an upsert target (it auto-purges per D17 —
portability is for the living library). Identities are NOT exported:
bookmark/collection/tag ids are meaningless across instances, so
relationships travel as tag NAMES and collection PATHS and the importer
re-links through them (imported libraries are structurally identical, not
id-identical — the round-trip e2e proves hierarchy, memberships, tags,
fields and timestamps).

### Export — `POST /data/export` (operationId `exportData`)

`{ format: json|csv|html|txt, collectionId? }` → streaming file download
(`Content-Disposition: attachment`, `arcdrop-export.<ext>`; bookmark rows
stream out in keyset-paged batches of 500 — never one giant buffer; HTML
buffers the rows it needs for the folder tree, personal-scale).
`collectionId` scopes to that collection's ACTIVE subtree (unknown or
trashed scope → 404 problem+json — validated BEFORE the stream starts, so
the 404 is still a problem document).

- **json** — full fidelity: `{ format: 'arcdrop/v1', exportedAt, scope,
collections: [{ path, icon, color, order }], tags: [names],
bookmarks: [{ url, title, excerpt, note, favorite, contentType, createdAt, updatedAt,
tags: [names], collections: [paths], highlights: [{ text, note, color, createdAt }] }] }`.
  Each bookmark carries its persisted `highlights` array plus `favorite` and
  `contentType` (M8 contract wired in M10). Paths are segment ARRAYS (`["Work",
"Rust"]`), so titles containing `/` or `;` round-trip losslessly.
- **csv** — `url,title,excerpt,note,tags,collections,createdAt,updatedAt`.
  Tags join with `;`, collection paths join with `/`, multiple collections
  with `;`. LOSSY (documented): titles containing `/`, `;` or `,` cannot
  round-trip; no highlights.
- **html** — Netscape bookmark file (`<!DOCTYPE
NETSCAPE-Bookmark-file-1>`), collections as nested `<H3>/<DL>` folders,
  `ADD_DATE` in UNIX seconds, `TAGS="a,b"`, note (or excerpt) as `<DD>`.
  LOSSY: a bookmark in several collections renders once (first path);
  tags with commas break the TAGS list.
- **txt** — one URL per line. Everything except URLs is lossy by definition.

### Import — `POST /data/import` (operationId `importData`)

Multipart/form-data, field `file`; format detected from the filename
extension (`.json` sniffs the dialect: our `format: 'arcdrop/v1'` marker vs
Raindrop's `link`-keyed items). Accepted: ArcDrop JSON (full-fidelity
round-trip), Raindrop JSON (collections via `$oid` parent chains; `{"id":
-1}` unsorted / `-99` broken → no collection; Raindrop highlights are
counted as skipped), CSV (our export columns), Netscape HTML, TXT (one URL
per line; blank lines ignored silently, broken lines error with their line
number), ENEX (Evernote — WEB CLIPS ONLY: the first external http(s) link
in a note is the source URL; notes without one are skipped and counted,
Evernote `20231118T120000Z` stamps parse), ZIP (classic archives only —
zip64 refuses; every supported member is parsed and aggregated, unsupported
members are skipped and counted with the member name; no recursion into
nested zips).

Response: `{ created, updated, skipped[], errors[] }` — skipped/errors
carry a reason + source (`row 12`, `note 3 "title"`, `archive.zip/x.csv:
row 2`) and are capped at 500 entries each (`… N more entries suppressed`
tail) so a hostile upload cannot return megabytes of reasons.

**The upsert contract (D13, orchestrator-ratified — read before touching
`import-upsert.service.ts`):**

- Match on `(userId, url)` over ACTIVE rows, exact verbatim url equality;
  several active duplicates resolve to the most recently updated row. A
  trashed duplicate absorbs nothing — a fresh ACTIVE row is created
  (duplicates are allowed, D13; the trash is read-only).
- Field merge = last-write-wins on `updatedAt` (plan D4's conflict rule):
  an item WITHOUT a parseable timestamp (CSV/HTML/TXT/ENEX) is treated as
  older and only fills gaps; empty/absent incoming fields never overwrite
  anything; a null DB field is filled regardless of age. `createdAt` is
  preserved on CREATE (from the item when it carries one), never restored
  on update.
- Tags and collection memberships are UNIONED — import never detaches,
  never prunes. Missing collections are created from nested title paths on
  demand (case-SENSITIVE title match against active rows; first definition
  wins when one file defines the same path twice; `order` honored from
  ArcDrop JSON, else appended). Missing tags go through the normal
  ci-unique rules (`resolveTagNames` — first spelling wins).
- Everything rides the normal domain services: URL decomposition (D12) on
  every url, `ChangeLogService.transact` per mutation, `tag:create` /
  `collection:create` / `bookmark:*` events — so `/sync/changes` from a
  pre-import cursor shows the whole import (e2e-proven).
- A matched bookmark counts as `updated` whether or not anything changed
  (the idempotency AC: re-import → all `updated`, zero `created`) — but a
  change event is recorded ONLY when a field, tag or membership actually
  changed. A no-op re-import leaves `users.sync_seq` untouched: devices
  are not spammed into refetching 1000 identical bookmarks.
- Bookmarks commit in CHUNKS of 50 (short transactions, the per-user seq
  lock held briefly, incremental sync visibility mid-import, and
  restartability: an aborted chunk leaves committed chunks behind and a
  re-run resumes idempotently). Per-item data problems (invalid URL,
  oversized fields, >50 tags, >100-char tag names) are caught at PARSE
  time and land in `errors` — an aborted chunk is a genuine infrastructure
  failure, not data.
- Created bookmarks get the metadata pipeline scheduled after the last
  chunk commits (bounded concurrency 4, fire-and-forget, silent failures —
  the same fill-if-null pipeline as `POST /bookmarks`, just pooled so a
  25 MB upload cannot open thousands of concurrent fetches).

**Caps + concurrency:** `ARCDROP__PORTABILITY__IMPORT_MAX_BYTES` (25 MiB)
for single files, `…_ZIP_MAX_BYTES` (300 MB) for `.zip` — enforced DURING
the streaming upload (a 400 MB body dies mid-stream, never after
buffering; the tighter non-zip cap binds right after parsing). Exceeding
either is a `413` problem+json (`code: PAYLOAD_TOO_LARGE`). ONE concurrent
import per user — a second request is a `409` problem+json
(`code: CONFLICT`); the lock is in-memory (single-instance posture, same
as the ws tickets). The upload is buffered in memory (multer
`memoryStorage`) — ≤ 300 MB RAM for one request, accepted v1 posture.
Multer joined as a DIRECT dependency for this (it was already in the tree
via `@nestjs/platform-express`; a custom interceptor wraps it because the
cap is config-driven and format-dependent — `FileInterceptor` caps are
decorator constants).

### Per-bookmark highlights export — `GET /bookmarks/{id}/highlights/export?format=txt|csv` (G4)

`txt`: quoted text blocks with optional `- note:` lines, blank-line
separated. `csv`: header `text,note,color,createdAt`. Wired to real `highlights`
rows in M10 (`PortabilityService.exportBookmarkHighlights` + ArcDrop JSON
export/import round-trip). Unknown bookmarks are 404s (trash included — GET
semantics mirror `GET /bookmarks/{id}`).

### Format quirks worth remembering

- ArcDrop JSON `highlights` are persisted on import (multiset-deduplicated on
  `(text, note, color)` so re-imports are idempotent with zero duplicate rows or
  no-op change events). Raindrop JSON highlights remain counted as skipped.
- Netscape parsing is regex-lenient (M6 philosophy): `<DT><H3>` opens a
  folder, `<DL>` nests it, `<DD>` maps to the bookmark NOTE, attributes
  are case-insensitive; malformed structure heals instead of failing.
- ENEX "web clip" detection is a HEURISTIC (ENEX has no clip marker): the
  first external http(s) `<a href>` wins; `evernote:///` internal links do
  not count; regular notes are skipped WITH their titles in the reason.
- CSV quoting is RFC 4180 (quotes doubled, commas/newlines inside quotes
  literal); the `tags`/`collections` sub-lists use `;` — see the lossy
  notes above.
- ZIP: stored + deflate members only, encrypted members refuse, EOCD found
  through a trailing comment, zip64 (> 65535 entries / ≥ 4 GiB members)
  refuses with a clear error. There is no filesystem extraction — members
  go straight into the parsers, so zip-slip does not apply.
- `POST /data/export` is a POST by ticket → mutation-classified for
  read-only PATs (consistent with `createSyncTicket`); the REST-level
  `PatScopeGuard` refuses it for read-only tokens the same way.

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
- **Throttling:** `@nestjs/throttler` — global default 100 req/min per IP; `/auth/*`
  and `/me/*` routes are capped at 10 req/min, and all 2FA endpoints (`/auth/tfa/*`
  and `/auth/login/tfa`) enforce an even stricter **5 req/min** per IP (the e2e
  suites prove 429 problem+json responses on excess).
- **Guards (order matters):** `ThrottlerGuard` → `JwtAuthGuard` (global; `@Public()`
  opts out — health probes and the public auth routes use it; accepts an
  access JWT **or** a personal access token since M7) → `PatScopeGuard`
  (M7/M15: PAT-only surface rules — refuses PATs with 403 on `/auth/*`,
  `/admin/*`, and `/me/*`, enforces read-only HTTP methods, and applies the
  per-PAT rate budget) → `RolesGuard` (`@Roles('admin')` on `/admin/*`).
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
  auth/                    /auth/* controller+service; crypto (JWT/argon2/opaque tokens/TOTP);
                           global guards (throttler, JWT-or-PAT, PAT scope, roles) +
                           @Public/@Roles/@CurrentUser
  users/                   /admin/users controller+service (invite/reset tokens via API) +
                           MeLifecycleController/AccountLifecycleService (M15 /me/reset-data, DELETE /me)
  settings/                SettingsService (typed DB settings) + /admin/settings
  change-log/              ChangeLogService (transact + gapless seq) + ChangeEventBus
                           (in-process fan-out for M5's ws push)
  bookmarks/               /bookmarks CRUD + bulk + trash/restore + list/search/stats;
                           `BulkBookmarksService` (M13: `POST /bookmarks/bulk`);
                           /bookmarks/{id}/tags; /tags/{name} rename/merge/delete;
                           /bookmarks/{id}/collections (delegates to CollectionsService);
                           /bookmarks/{id}/reindex (schedules the M6 pipeline);
                           UrlDecompositionService (D12); `search-query.parser.ts` +
                           `search-query.compiler.ts` (M11 grammar); TrashPurgeService +
                           cron job (purge now fires the icon-eviction ride-along)
  collections/             /collections flat list + tree + CRUD + restore + order +
                           M13 `merge` / `sort-alphabetical` / `delete-empty`;
                           cycle protection, two-phase delete, membership sync;
                           tree-builder.ts & collection-bulk-helpers.ts (pure, unit-tested)
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
  tokens/                  M7: /me/tokens (personal access tokens — hashed at rest,
                           labeled, revocable, optional read-only scope; plaintext
                           returned exactly once) + pat-token primitives
  audit/                   M7: AuditService — one fire-and-forget audit row per MCP
                           tool call (success and failure); M9 builds the read side
  mcp/                     M7: /api/v1/mcp Streamable HTTP endpoint (official SDK,
                           per-session Server + transport, sessions bound to the
                           creating credential); tool catalog mirroring the REST
                           surface (names = operationIds, schemas = DTO metadata);
                           per-tool read-only enforcement + audit
  portability/             M8: POST /data/export (streaming json/csv/html/txt,
                           collectionId subtree scope) + POST /data/import
                           (multipart; ArcDrop/Raindrop JSON, CSV, Netscape HTML,
                           TXT, ENEX web clips, ZIP — URL-keyed upsert with LWW
                           merge, per-user import lock, dynamic caps); GET
                           /bookmarks/{id}/highlights/export (txt/csv — M8
                           contract, M10 storage); pure parsers under import/,
                           pure renderers under export/
  notifications/           M14: `GET /notifications` & `POST /notifications/read`
                           inbox backed by `NotificationOutbox`; `RemindersService`
                           & per-minute `RemindersJob` (`FOR UPDATE OF b SKIP LOCKED`
                           + post-commit `SyncGateway.pushToUser`, WS-only per D20)
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
  mcp.e2e.test.ts              M7 suite (PAT handshake → tools/list → tools/call,
                               agent-first-class proof: REST-visible + change-logged +
                               ws-pushed mutations, PAT lifecycle, read-only refusals
                               per tool and per method, tools/list ↔ DTO ↔ OpenAPI
                               parity, JSON-RPC errors, audit rows, per-PAT rate
                               budget (isolated boot), no /ai/* routes)
  portability.e2e.test.ts      M8 suite (JSON round-trip identity, double-import
                                idempotency with zero no-op events, Raindrop +
                                Netscape + TXT + ENEX + ZIP fixtures, CSV round-trip,
                                collectionId scope export + 404, trash-not-exported,
                                highlights downloads, sync visibility from a
                                pre-import cursor, 409 import lock, MCP import/
                                export tools incl. read-only refusals, import caps
                                413 (isolated boot))
  search-operators.e2e.test.ts M11 suite (all search operators, quoting/escapes,
                                NULL-safe negations, match:OR vs default AND, `q` alias +
                                conflict 400, REST filter composability, reserved/unknown
                                operator 400s with positions, OpenAPI & MCP `listBookmarks`)
  bulk-operations.e2e.test.ts  M13 suite (`POST /bookmarks/bulk`, `POST /collections/merge`,
                                `sort-alphabetical`, `delete-empty`, mid-list invalid rollback,
                                2nd-device cursor sync reconstruction, MCP parity, shared
                                isolated per-user `bulk` rate limit)
  reminders-notifications.e2e.test.ts  M14 suite (live WS reminder push + outbox persistence,
                                concurrent double-run exactly-once sweep, offline inbox catch-up
                                & mark-read, cancel/trash/delete paths, disabled-user skip,
                                `reminder=` / `reminder:` filter & operator, UTC normalization,
                                MCP parity, D20 zero-SMTP check)
  zip-builder.ts               test-only minimal ZIP WRITER (inverse of the M8
                                reader) — builds stored/deflate archives for fixtures
```

Both `main.ts` and the e2e boots go through `app-setup.ts` — keep runtime behavior and
tests in lockstep by wiring new app-level concerns THERE.

## Decisions recorded (M8)

- **Highlights are CONTRACT-ONLY in M8 — ratified scope discipline.** The
  amended ticket puts highlights export in scope (G4) but the plan defers
  the Highlight entity + REST surface to M10. M8 therefore ships the
  formats (JSON bookmarks carry a `highlights: []` section; the
  per-bookmark txt/csv downloads exist and are well-formed) and the ONE
  M10 plug-in point (`M10 HOOK` in `PortabilityService`), with nothing
  to persist yet. The e2e proves the contract as well-formed-empty; M10's
  ticket owns flipping it to real rows.
- **The upsert never writes no-op events.** A matched bookmark counts as
  `updated` (the idempotency AC), but the change event fires only when a
  field, tag or membership actually changed — a 1000-bookmark re-import
  must not push 1000 `bookmark:update` notifications that make every
  device refetch identical rows. This deliberately departs from the M4
  membership-sync "always record" convention because import no-ops are the
  COMMON case, not an explicit client action. `/sync/changes` still sees
  every real change (e2e-proven from a pre-import cursor).
- **Field merge is last-write-wins on `updatedAt`** (plan D4's conflict
  rule), with two absolutes: empty/absent incoming data never overwrites
  anything, and null DB fields fill regardless of age. Items without a
  parseable timestamp (CSV/HTML/TXT/ENEX) are treated as older — the
  database row wins every non-empty field. The decision lives in ONE pure
  function (`pickFieldPatch`) so it stays testable and reviewable.
- **Import commits in chunks of 50, not one transaction.** Short
  transactions keep the per-user seq lock held briefly, make import
  progress visible via `/sync/changes` mid-import, and make a failed run
  restartable: committed chunks stay, a re-run resumes idempotently (D13
  upsert). Per-item data problems are caught at PARSE time so an aborted
  chunk means infrastructure, not data.
- **The export covers the ACTIVE library only; identities travel as names
  - paths.** Trash is ephemeral by design (D17 auto-purge) — exporting it
    would resurrect purged data on another instance. Ids are meaningless
    across instances, so memberships re-link through tag NAMES and
    collection title PATHS; the round-trip is structurally identical, not
    id-identical (that is what the e2e asserts).
- **Multer joined as a direct dependency — justified.** It was already in
  the dependency tree (`@nestjs/platform-express` requires it); nothing
  declared it, so the isolated linker never linked it. A custom
  interceptor wraps the raw multer API because the cap is CONFIG-driven
  and format-dependent (FileInterceptor caps are decorator constants), and
  because multer errors must translate to problem+json (413/400).
  Hand-rolling multipart parsing for 300 MB uploads would be strictly
  worse — same reasoning as the M5 `ws` and M7 SDK additions.
- **Caps enforce DURING the streaming upload; memoryStorage accepted.**
  Stream-time enforcement uses the larger (ZIP) cap so an oversized body
  dies mid-stream; the tighter non-zip cap binds right after parsing once
  the filename is known. One upload lives in RAM (≤ 300 MB) — fine for
  single-instance v1, revisit with M9's hardening pass if self-hosters
  report memory pressure.
- **The MCP import cap is 1 MiB decoded, and the global JSON body limit
  rose to 2 MB** (registered in `setupApp` ahead of Nest's defaults, so
  it REPLACES the 100 KB express default for every JSON route). Sized for
  the MCP import envelope (base64 + tool-call framing); REST multipart
  remains the path for big imports. M9 re-examines global limits with real
  traffic numbers.
- **ENEX web-clip detection is an honest heuristic.** ENEX has no clip
  marker; the first external http(s) link wins and link-less notes are
  skipped WITH their titles. Evernote's compact timestamps
  (`20231118T120000Z`) get a dedicated parser. Documented as lossy-by-
  contract rather than pretending at full note fidelity.
- **The minimal ZIP reader hand-rolled, zero deps.** Classic archives
  only: central-directory walk, stored + deflate members (node:zlib),
  EOCD through trailing comments, zip64 and encrypted members refuse with
  clear errors. No filesystem extraction — members go straight into the
  format parsers, so zip-slip cannot apply. A test-only ZIP WRITER
  (`test/zip-builder.ts`) provides fixtures without a dependency.

## Decisions recorded (M7)

- **The SDK gate ran FIRST and passed.** `@modelcontextprotocol/sdk@1.32.2`
  on Bun 1.4.2 through the exact production path: Express +
  `StreamableHTTPServerTransport` (the Node wrapper), stateful sessions
  with `Mcp-Session-Id` round-trip, SSE-formatted responses parsed by a raw
  client, session DELETE teardown, and the SDK's own
  `StreamableHTTPClientTransport` completing the full handshake. No Bun
  incompatibilities surfaced; the gate script's assertions live on as the
  MCP e2e suite.
- **Tool schemas are generated from the DTO validation metadata, not
  hand-written.** `class-validator-jsonschema` converts the same
  class-validator decorators the REST ValidationPipe enforces — the
  published input schema and the executed validation are literally the same
  metadata, so the ticket's "can never drift" requirement holds by
  construction, and the e2e parity test re-derives everything live. The
  schema-conversion cache is per-DTO and retrying on miss: bun runs all
  test files in one process, and DTO modules register their decorators as
  they load, so a schema requested early must not freeze a partial
  registry.
- **Read-only enforcement is method-derived everywhere.** REST: the
  `PatScopeGuard` refuses non-safe methods for read-only PATs (route
  handlers never decide). MCP: every tool call is an HTTP POST, so the MCP
  controller is the one `@PatScopeDeferred()` route and the dispatcher
  refuses per-tool — but the mutation flag is DERIVED from the mirrored
  operation's REST method, so tool-level and REST-level rules cannot
  disagree (asserted by tests on both layers). `createSyncTicket` and
  `reindexBookmark` are mutation-classified (POST at REST) — a read-only
  agent polls `/sync/changes` instead of holding a ws push.
- **Sessions are bound to the credential that created them.** A session id
  presented with a DIFFERENT bearer (other user, or the same user via a
  different token) is a `404`, identical to an unknown session — nothing is
  revealed about whose session it is. In-memory registry capped at 1000
  (`503` JSON-RPC error above), cleanup on transport close and shutdown;
  single-instance posture documented.
- **The audit table has no foreign keys on purpose.** `audit_log_entries`
  rows must outlive the users and tokens they describe (no cascade
  surprises when M15-era user deletion arrives); `userId`/`patId` are plain
  indexed columns. The write is fire-and-forget — an audit failure is a
  warning, never a failed tool call. Rows are final-shaped for M9's admin
  read surface; no backfill needed.
- **Per-PAT rate budget is env-tunable and in-memory.**
  `ARCDROP__MCP__PAT_REQUESTS_PER_MINUTE` (default 300) counts REST + MCP
  per token; fixed window in-process — same rationale as the ws ticket
  store (v1 single instance; a restart costs nothing but a window reset).
  It sits ABOVE the global per-IP budget on purpose so it only bites
  multi-address abuse of a single token.
- **The MCP endpoint is exempt from problem+json, nothing else.** The
  endpoint speaks JSON-RPC per the transport spec (HTTP-level JSON-RPC
  error objects for session problems; `isError` tool results for domain
  failures — agents act on those, not on RFC 7807 documents). Auth,
  throttling, and the PAT surface rules all still apply: anonymous
  initialize is a 401 from the very same guard chain.
- **New runtime dependencies: `@modelcontextprotocol/sdk` and
  `class-validator-jsonschema`.** Both are `--external` in the build (like
  `ws` in M5) and come from manifests in the Docker runtime stage; the
  bundle shrank ~1.3 MB by not inlining them. The SDK's zod range
  (`^3.25 || ^4.0`) is satisfied by the repo's zod v4.
- **Highlights are NOT in the v1 catalog — ratified omission.** The plan
  settles highlights (D6) but no milestone ever built the REST surface;
  per the orchestrator's ruling, the highlights REST surface moves to
  wave-2 M10 and its tools land there through the M7 catalog convention
  (see the worked example above). Every wave-2 ticket that adds REST
  surface now carries an explicit "add the matching MCP tools" scope line.

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

## Hardening, Audit & Self-Host Ops (M9)

### Rate limits (verified under load)

- **Global IP throttle:** `100/min` per controller handler per IP (`ThrottlerGuard`).
- **Strict auth throttle:** `10/min` per IP on `/api/v1/auth/*` login/bootstrap/refresh/claim endpoints.
- **Public icon cache throttle:** `300/min` per IP on `GET /api/v1/icons/{id}`.
- **Per-PAT shared budget:** `ARCDROP__MCP__PAT_REQUESTS_PER_MINUTE` (default `300/min`) shared across REST and `/api/v1/mcp`.
- **Per-user expensive-route limits (`UserRateLimitGuard`):**
  - `POST /api/v1/data/import` & MCP `importData`: `30/min` (`ARCDROP__RATE_LIMIT__IMPORT_PER_MINUTE`)
  - `POST /api/v1/bookmarks/{id}/reindex` & MCP `reindexBookmark`: `30/min` (`ARCDROP__RATE_LIMIT__REINDEX_PER_MINUTE`)
  - MCP `tools/call`: `300/min` (`ARCDROP__RATE_LIMIT__MCP_TOOLS_PER_MINUTE`)
  - `POST /api/v1/bookmarks/bulk`, `POST /api/v1/collections/{merge,sort-alphabetical,delete-empty}`, & matching MCP bulk tools: `30/min` (`ARCDROP__RATE_LIMIT__BULK_PER_MINUTE`)
- **Smoke load script:** `ARCDROP_SMOKE_URL=http://127.0.0.1:3000 bun run load:smoke` exercises auth, reindex, global IP, PAT REST+MCP shared limits, 413 body limit, and end-to-end `x-request-id` correlation.

### Admin audit surface & M2 action auditing

- **Endpoint:** `GET /api/v1/admin/audit` (`operationId: listAuditLogs`) — admin session only (regular users and all PATs receive `403`), ordered newest-first (`createdAt DESC, id DESC`), paged (`page`, `pageSize` clamped to 200), filterable by `action`, `actorUserId`, `actorType`, `outcome`, `subject`, `since`, `until`.
- **Coverage:** M7 MCP `mcp.tools.call` entries plus M2 admin operations (`admin.user.create`, `admin.user.update`, `admin.user.reset_password`, `admin.settings.update`), recording both `ok` and `error` outcomes. Invite/reset token secrets are **never** written to `audit_log_entries.detail`.

### Self-Host Operational Checklist

1. **Required env vars:** set `ARCDROP__DATABASE__URL` and `ARCDROP__JWT__SECRET` (min 32 random hex/base64 chars, e.g. `openssl rand -hex 32`). Keep `ARCDROP__METADATA__ALLOW_PRIVATE=false` outside tests.
2. **First-run bootstrap:** start Compose (`docker compose up -d`), wait for `GET /api/v1/readyz` (`200`), then call `POST /api/v1/auth/bootstrap` once with the initial admin email/password (subsequent calls return `409`).
3. **Retention knobs (DB-backed via `PUT /api/v1/admin/settings`):**
   - `trashRetentionDays` (default `30`, min `1`) — hard-purge job runs daily at `03:00`.
   - `changeLogRetentionDays` (default `90`, min `1`) — sync compaction runs daily at `04:00`.
   - Icon orphan eviction runs daily at `05:00` (and rides along after trash purge).
4. **Logs:** structured pino JSON written to stdout (collected by Docker `json-file` driver with `max-size: 10m`, `max-file: 5`). Set `ARCDROP__LOG__LEVEL` (`info` default, `debug`/`trace` for troubleshooting, `warn`/`error` for quiet prod). Authorization headers and cookies are redacted; `x-request-id` threads request → response → error logs → `problem.requestId`.
5. **Reverse-proxy TLS & backups:** deploy behind Caddy or Nginx terminating TLS (see [`docs/backup-restore.md`](docs/backup-restore.md)); run regular `pg_dump -Fc` + `arcdrop-data` volume backups together.
6. **Dependency policy:** runtime dependencies in `apps/api/package.json` are pinned to exact `bun.lock` versions; `bun audit --audit-level=high` is clean and the production container (`bun install --production`) ships zero dev/ESLint packages.
7. **Security revisits (M9):**
   - _SSRF DNS-rebinding (M6):_ Bun 1.4.2 `fetch()` lacks a custom DNS lookup hook; documented residual risk & operational egress-firewall/DNS mitigations in [`docs/backup-restore.md`](docs/backup-restore.md#revisit-1--ssrf-fetcher-dns-rebinding-window-from-m6).
   - _JSON body limit (M8):_ tightened global JSON cap to `256 KB`, scoped `2 MB` strictly to `/api/v1/mcp`.

## Bookmark enrichment (M10 — D6, D19)

M10 opens Wave 2 with highlights, favorites, automatic content-type classification, and quick-add:

- **Highlights (`D6`):** `Highlight` entity (`id`, `bookmarkId` FK `ON DELETE CASCADE`, `userId` FK `ON DELETE CASCADE`, `text`, `note`, `color`, timestamps — hard-deleted; no soft-delete column needed because bookmark trash preserves highlights, restore re-enables mutations, and hard purge emits explicit `highlight:delete` tombstones before cascading). Routes: `GET/POST /bookmarks/{id}/highlights` (`listHighlights`, `createHighlight`), `PUT/DELETE /highlights/{id}` (`updateHighlight`, `deleteHighlight`). `'highlight'` added to `change_entity` enum; `/sync/changes` serves `HighlightSnapshotDto` + delete tombstones.
- **M8 portability closure:** `PortabilityService.exportBookmarkHighlights` and ArcDrop JSON export/import now persist and round-trip real highlight rows (plus `favorite` and `contentType`) idempotently.
- **Favorites:** `Bookmark.favorite` (`boolean`, default `false`), toggled via `PUT /bookmarks/{id}` or set on create/quick-add; `GET /bookmarks?favorite=true|false` filter; `GET /bookmarks/stats` returns `{ total, unassigned, trashed, favorites }`.
- **Content-type detection:** `Bookmark.contentType` (`article | image | video | audio | document | book | link`, default `'link'`), classified in the M6 pipeline via `classifyContentType` (response `Content-Type` → `og:type` → URL file extension → known host patterns → `'link'`). Filterable via `GET /bookmarks?type=…` and re-classified on `POST /bookmarks/{id}/reindex`.
- **Quick-add:** `POST /bookmarks?url=…&title=…&excerpt=…&note=…&favorite=…&collection=…` shares the exact `CreateBookmarkDto` validation, D13 duplicate-allowing insert, and async enrichment pipeline with JSON body `POST /bookmarks`, plus optional `collection` attachment (active collection UUID or exact active title).
- **MCP parity:** 31 tools (11 reads, 20 mutations) including `listHighlights`, `createHighlight`, `updateHighlight`, `deleteHighlight`, and DTO-derived `favorite`/`type` support on `listBookmarks` and `updateBookmark`.

## Search operators (M11 — D19, Raindrop parity G9)

`GET /api/v1/bookmarks` (`search` or alias `q`) and the mirrored MCP tool `listBookmarks` share **one canonical Raindrop-compatible search grammar** implemented as a pure, field-model-driven parser (`src/bookmarks/search-query.parser.ts`) and TypeORM SQL compiler (`src/bookmarks/search-query.compiler.ts`):

| Syntax                                    | Meaning                                                                                    | Notes                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `word` / `"exact phrase"`                 | Case-insensitive substring match across `title`, `excerpt`, `note`, `url`, and tag names   | `\"` and `\\` escapes inside quotes; LIKE metacharacters (`%`, `_`, `\`) escaped                                     |
| `-word` / `-"exact phrase"`               | Exclusion across the same fields                                                           | Uses `COALESCE(col, '')` so `NULL` `title`/`excerpt`/`note` never drop rows                                          |
| `#tag` / `#"multi word tag"`              | Exact tag name match (`tags.name_lower`)                                                   | Negatable with `-#tag` / `-#"multi word tag"`                                                                        |
| `title:` / `excerpt:` / `note:` / `link:` | Field-scoped substring match (`link:` aliases `url`)                                       | Supports `"quoted phrases"` and `-` prefix negation                                                                  |
| `type:<X>`                                | Content type (`article\|image\|video\|audio\|document\|book\|link`)                        | Case-insensitive value; negatable (`-type:video`)                                                                    |
| `favorite:true\|false`                    | Favorite flag filter                                                                       | Negatable (`-favorite:true`)                                                                                         |
| `notag:true\|false`                       | Untagged (`true`) or has ≥1 tag (`false`)                                                  | Negatable (`-notag:true`)                                                                                            |
| `created:` / `lastUpdate:`                | UTC date/range filter with optional `<`, `>`, `<=`, `>=` prefix and `YYYY[-MM[-DD]]` value | `created:2025-05` matches `[2025-05-01T00:00Z, 2025-06-01T00:00Z)`; calendar-validated (incl. leap years); negatable |
| `match:OR` / `match:AND`                  | Match mode (`AND` default)                                                                 | In `OR` mode, positive clauses are OR'd and exclusions (`-...`) stay ANDed outside                                   |
| `broken:true\|false`                      | Broken-link state (`brokenAt IS NOT NULL` / `IS NULL`) — active since M12                  | Negatable (`-broken:true`); reflects instance `brokenLinkCheckMode` sweeps                                           |
| `file:` / `reminder:`                     | Reserved Wave-2 operators (M18 / M14)                                                      | Fail explicitly with `400 BAD_REQUEST` (`"operator not available yet"`)                                              |

- **Error contract:** invalid syntax, unknown operators (`foo:bar`), bad dates, reserved operators, or supplying both `search` and `q` return `400 BAD_REQUEST` (`application/problem+json` on REST, `CallToolResult { isError: true }` on MCP) with the exact character `position` in the message. Bare URLs (`https://…`), time-like numbers (`12:30`), lone `-`, and `--flags` stay plain text terms.
- **Composability & M17 extensibility:** compiled grammar predicates compose via `AND` with all REST query parameters (`collectionId`, `tag`, `domain`, `favorite`, `type`, `unassignedOnly`, `trashed`, `updatedSince`). `DEFAULT_TEXT_SEARCH_FIELDS` and `DEFAULT_TEXT_FIELD_BUILDERS` are registry-driven so M17 can plug in full-text `content` / `highlights` fields without rewriting the parser.

## Library health (M12 — D13, D19, Raindrop parity G10, G11)

- **Scope note (URL bookmarks only):** File-backed bookmarks do not exist yet (arriving in M18), so both duplicate grouping and broken-link sweeping operate solely on active URL bookmarks.
- **Duplicates finder (`GET /api/v1/library/duplicates`, operationId `findDuplicates`):** Groups the caller's non-trashed URL bookmarks using `normalizeBookmarkParts` (`src/library-health/url-normalize.ts`, built over D12 `urlParts` without altering verbatim `url` storage per D13): ignores scheme, strips leading `www.` on multi-label hosts (keeping non-`www.` subdomains), preserves non-default ports, strips trailing slashes on non-root paths while preserving case sensitivity, drops fragments, removes tracking parameters (`utm_*`, `fbclid`, `gclid`, `ref`, `mc_cid`, `mc_eid`, case-insensitive), and sorts remaining query parameters deterministically. Groups with `≥ 2` rows return `{ normalizedUrl, original, extras[] }` ordered oldest-first (`createdAt ASC, id ASC`).
- **Transactional resolve (`POST /api/v1/library/duplicates/resolve`, operationId `resolveDuplicates`):** Validates `keepId` and `trashIds[]` (active, owned, `keepId ∉ trashIds`), merges unique tags and collection memberships onto `keepId`, soft-trashes `trashIds` (`deletedAt = now`), and records change events for the modified keeper, touched collections, and trashed extras inside one `ChangeLogService.transact` transaction so sync cursors reconstruct the exact merged state.
- **Broken-links scanner:** Adds `lastCheckedAt`, `brokenReason`, and `brokenAt` on `Bookmark` (migration `M12LibraryHealth1794629705566`, exposed on `BookmarkDto` and sync snapshots) plus the instance setting `brokenLinkCheckMode` (`'off' | 'basic' | 'default' | 'strict'`, default `'default'`, admin-managed via `PUT /admin/settings`):
  - `off`: scanner never checks.
  - `basic`: marks `404` / `410` only.
  - `default`: `basic` + DNS resolution failure (`dns-resolution-failed`).
  - `strict`: `default` + `5xx` + timeouts / redirect loops / missing-location redirects / network errors.
- **SSRF & gentle scheduling:** `BrokenLinksService` reuses M6's `SsrfSafeFetchService.probeUrl` (DNS-resolve-first, private-IP blocking on hop 0 when `ALLOW_PRIVATE=false` and strictly on every hop `≥ 1`, `HEAD` with `405` → `GET` fallback). Policy refusals (`private-address-blocked`, `scheme-refused`, `invalid-url`, `unclassifiable-address`) are skipped without connecting or flagging broken. `BrokenLinksJob` runs daily at `06:00` (staggered behind `03:00` trash purge, `04:00` sync retention, `05:00` icon eviction) with concurrency capped at `≤ 5` and jittered intervals. Successful recovery (`2xx–3xx`) or editing a bookmark's URL (`PUT /bookmarks/{id}`) clears `brokenAt`/`brokenReason` (and records `bookmark:update` on sweep status changes).
- **Filtering & MCP parity:** `GET /bookmarks?broken=true|false` and M11 grammar `broken:true|false` (`-broken:true`) filter active/trashed lists; `findDuplicates` and `resolveDuplicates` are registered in `src/mcp/mcp-tool-catalog.ts` (33 tools total: 12 reads, 21 mutations, with read-only PAT enforcement on `resolveDuplicates`).

## Bulk operations (M13 — D19, Raindrop parity G14)

- **Bookmarks bulk (`POST /api/v1/bookmarks/bulk`, `operationId: bulkBookmarks`):** Executes `move` (`collectionIds`, `mode: 'assign' | 'union'`), `addTags` / `removeTags` (ci-unique tag rules + orphan pruning), `trash`, `restore`, or `delete` (hard delete strictly for already-trashed IDs per M4 two-phase semantics; active IDs return `409 CONFLICT` and hard deletes emit `highlight:delete` tombstones before cascading + ride-along icon eviction) over 1–500 unique bookmark IDs in one `ChangeLogService.transact` transaction. Uses flat optional `collectionIds` / `mode` / `tags` fields on `BulkBookmarksDto` so `class-validator-jsonschema` emits `$ref`-free JSON Schema for MCP `tools/list`.
- **Collections merge (`POST /api/v1/collections/merge`, `operationId: mergeCollections`):** Validates `sourceIds` (1–500, active, owned) and `targetId` (active, owned, `targetId ∉ sourceIds` → `400`, not a descendant of any source → `409 CONFLICT`), reparents non-source direct children onto `targetId`, inserts/deduplicates `bookmark_collections` memberships onto `targetId` and removes old source memberships, soft-trashes `sourceIds`, and records change events for `target`, moved children, trashed sources, and affected bookmarks inside one transaction.
- **Alphabetical sort (`POST /api/v1/collections/sort-alphabetical`, `operationId: sortCollectionsAlphabetical`):** Pure `planAlphabeticalSort` (`src/collections/collection-bulk-helpers.ts`) reorders roots and every nested sibling group case-insensitively with deterministic tie-breaking, updating and change-logging only rows whose `order` actually changes; returns `{ updated }`.
- **Delete empty (`POST /api/v1/collections/delete-empty`, `operationId: deleteEmptyCollections`):** Pure `findRecursivelyEmptyCollectionIds` identifies active collections whose active subtree contains zero active (non-trashed) bookmarks (collections holding only trashed bookmarks count as empty), soft-trashes them in one transaction, and returns `{ trashed, kept }`.
- **Atomicity, rate limit & MCP parity:** Any mid-list invalid/foreign ID or state conflict rolls back the entire transaction cleanly with zero partial writes and zero sync events. All 4 routes and their mirrored MCP tools share the per-user `bulk` bucket (`ARCDROP__RATE_LIMIT__BULK_PER_MINUTE`, default `30/min`). MCP catalog now holds **37 tools** (12 reads, 25 mutations).

## Reminders & notifications (M14 — D19, D20, Raindrop parity G12)

- **Bookmark reminder fields (`M14RemindersNotifications1794632472998`):** Adds nullable `timestamptz` columns `reminderAt` and `remindedAt` on `Bookmark` (with `IX_bookmarks_user_reminder_at` and partial due index `IX_bookmarks_reminder_due`). Both are stored in **UTC** (clients render local time; documented in OpenAPI on `BookmarkDto`, `CreateBookmarkDto`, `CreateBookmarkBodyDto`, `UpdateBookmarkDto`, and `NotificationPayloadDto`). Set/clear via `PUT /bookmarks/{id}` (and optional on `POST /bookmarks`). Re-sending the same `reminderAt` preserves `remindedAt` (already-fired reminders never re-fire); sending a new timestamp clears `remindedAt` to arm a fresh one-time reminder; explicit `null` clears both `reminderAt` and `remindedAt`. Every change is recorded through `ChangeLogService.transact` (`bookmark:update`).
- **Due-reminder sweep (`RemindersJob` + `RemindersService`):** Runs every minute via `@nestjs/schedule` (`@Cron(CronExpression.EVERY_MINUTE)` with an in-process `running` overlap guard). Queries active (non-trashed) bookmarks with `reminder_at <= now AND reminded_at IS NULL` joined to `users.status = 'active'` using `FOR UPDATE OF b SKIP LOCKED`, writes durable `NotificationOutbox` rows (`{ id, userId, type: 'reminder', bookmarkId, payload, createdAt, readAt }`), stamps `remindedAt`, and records `bookmark:update` change events atomically. Strictly **after commit**, calls `SyncGateway.pushToUser(userId, { type: 'reminder', bookmarkId, title })` — WS-only delivery with **no SMTP** (D20). Clearing `reminderAt`, trashing (single or bulk), or deleting cancels pending fires; disabled users skip.
- **Notifications inbox:** `GET /api/v1/notifications?unread=true|false&page=&pageSize=` (`operationId: listNotifications`, `pageSize` clamped to 200) and `POST /api/v1/notifications/read` (`operationId: markNotificationsRead`, accepting `{ ids }` or `{ all: true }`, idempotent, rejecting empty or both with `400 BAD_REQUEST`) provide the offline catch-up path. `NotificationOutbox.bookmarkId` uses `ON DELETE SET NULL` while retaining `payload` history when a bookmark is purged.
- **Filtering, search grammar & MCP parity:** Activates `reminder:true|false` (`-reminder:true`) in `search-query.parser.ts` & `search-query.compiler.ts` (only `file:` remains reserved for M18) and `GET /bookmarks?reminder=true|false`. Adds `listNotifications` and `markNotificationsRead` to `src/mcp/mcp-tool-catalog.ts` (39 tools total: 13 reads, 26 mutations).

## Two-factor authentication & account lifecycle (M15 — D15, D19, D20, Raindrop parity G5, G13)

- **TOTP 2FA crypto (`src/auth/crypto/totp.service.ts`):** Hand-rolled on Node/Bun `node:crypto` (RFC 4226 HOTP, RFC 6238 TOTP, RFC 4648 Base32) matching `JwtService`’s zero-dependency posture, unit-tested against all RFC 6238 Appendix B SHA1/SHA256/SHA512 test vectors (`totp.service.test.ts`). Secrets are 160-bit (20 random bytes → 32 Base32 chars), encrypted at rest with AES-256-GCM (`v1:<iv>.<tag>.<ciphertext>`) keyed from `ARCDROP__JWT__SECRET`, and verified over a 30s period with `±1` step tolerance (`timingSafeEqual`).
- **Setup, enable & disable (`AuthController` + `AuthService`):**
  - `POST /api/v1/auth/tfa/setup` (`operationId: setupTfa`) mints a pending secret + `otpauth://totp/ArcDrop:...` URI while keeping `totpEnabled: false` (`409 CONFLICT` if already enabled).
  - `POST /api/v1/auth/tfa/enable` (`operationId: enableTfa`) confirms a valid 6-digit TOTP code (`400` before setup, `401` on invalid code), flips `totpEnabled = true`, mints **10 single-use `xxxxx-xxxxx` recovery codes** returned **once** (sha256-hashed at rest in `tfa_recovery_codes`), and revokes **all** active sessions (`refresh_tokens`).
  - `POST /api/v1/auth/tfa/disable` (`operationId: disableTfa`) requires either a valid TOTP `code` or an unconsumed `recoveryCode`, clears the secret, deletes recovery codes, voids pending challenges, and revokes **all** active sessions.
- **Two-step login & hard throttling:** When password authentication succeeds for a user with `totpEnabled: true`, `POST /api/v1/auth/login` throws `401 application/problem+json` carrying `code: "TOTP_REQUIRED"`, a single-use 5-minute `challenge` token (`one_time_tokens.type = 'tfa_challenge'`, unusable on `/auth/claim`), and `expiresAt`. `POST /api/v1/auth/login/tfa` (`operationId: loginTfa`) exchanges `{ challenge, code | recoveryCode }` for a normal `{ user, accessToken, refreshToken }` session pair; recovery codes mark `used_at` atomically and work at most once. All four 2FA endpoints (`/auth/tfa/setup`, `/auth/tfa/enable`, `/auth/tfa/disable`, `/auth/login/tfa`) enforce a strict **5 req/min** IP throttle (`429 TOO_MANY_REQUESTS`), and `PatScopeGuard` blocks all PAT access (`403`) on `/auth/*`, `/admin/*`, and `/me/*` (zero MCP tools added for 2FA or account lifecycle).
- **Recovery-code caveat (no SMTP escape hatch — D15, D20):** ArcDrop has **no outbound email/SMTP recovery flow by design**. If a user loses both their authenticator app/TOTP secret and all single-use recovery codes, they cannot log into their account via self-service. Store the one-time recovery codes offline when enabling 2FA.
- **Account lifecycle (`MeLifecycleController` + `AccountLifecycleService`):**
  - `POST /api/v1/me/reset-data` (`operationId: resetOwnData`): Password-confirmed (`401` on bad password), hard-wipes all user library data (`notification_outbox`, `change_events`, `highlights`, `bookmark_tags`, `bookmark_collections`, `bookmarks`, `tags`, `collections`) inside one transaction, resets `users.sync_seq = 0`, and fires ride-along orphaned icon eviction (`204`). Profile, instance settings, active sessions, PATs, and 2FA enrollment survive; devices holding old cursors (`since > 0`) receive `{ resyncRequired: true, changes: [], cursor: "0" }` cleanly; other users’ libraries are untouched.
  - `DELETE /api/v1/me` (`operationId: deleteOwnAccount`): Password-confirmed self-delete (`204`), wiping all library data, `tfa_recovery_codes`, `personal_access_tokens`, `refresh_tokens`, `one_time_tokens`, and the `users` row + ride-along icon eviction. Locks active admins (`FOR UPDATE`) and returns `409 CONFLICT` if the caller is the **last active admin** (preserving M2’s `/admin/users/{id}` guardrail).
  - **Account-to-account transfer:** No bespoke transfer endpoint is needed — export the source account’s library using M8’s `POST /api/v1/data/export` with `{ format: "json" }` (`arcdrop/v1` full-fidelity archive including collections, tags, timestamps, favorites, content types, and highlights), then upload that JSON file to the destination account via `POST /api/v1/data/import` (and optionally call `POST /api/v1/me/reset-data` or `DELETE /api/v1/me` on the source account).

## Decisions recorded (M15)

- **Hand-rolled TOTP on `node:crypto`:** Implementing RFC 4226/6238/4648 directly keeps zero external runtime dependencies and matches `JwtService`’s auditability (verified against RFC 6238 Appendix B SHA1/SHA256/SHA512 vectors).
- **PAT isolation broadened to `/me/*`:** `PatScopeGuard` now blocks PATs across the entire `/me` controller prefix (`/me/tokens`, `/me/reset-data`, `DELETE /me`) in addition to `/auth/*` and `/admin/*`; e2e MCP parity excludes `/api/v1/me` & `/api/v1/me/*` so agent/token credentials can never mutate account lifecycle or mint/revoke credentials.
- **`ProblemDetailsDto` + `ProblemJsonFilter` extension preservation:** Non-standard top-level problem extensions returned in `UnauthorizedException` payloads (`challenge`, `expiresAt` on `401 TOTP_REQUIRED`) are preserved verbatim alongside `code` and documented in OpenAPI `ProblemDetailsDto`.

## Manual ordering (M16 — D19, D21, Raindrop parity G8)

- **Why order lives on `bookmark_collections` (D21):** In ArcDrop, bookmarks belong to collections M:N rather than 1:N, so storing a single global `order` column on `bookmarks` would couple unrelated collections (dragging a bookmark in Collection A would scramble its position in Collection B). Storing `order` on the `bookmark_collections` join row gives each collection an independent manual order without inventing an unusable global order.
- **Schema & pre-existing row migration (`M16ManualOrdering1794634989570`):** Adds nullable `bookmark_collections.order` (`integer DEFAULT 0`) and `IX_bookmark_collections_collection_order (collection_id, order)`. Existing memberships created before M16 receive `0` via the migration default (and any `NULL` order values sort `NULLS LAST` under `sort=manual` before falling back to `bc.created_at ASC, b.id ASC`).
- **Append + concurrency serialization (`src/collections/membership-order.ts`):** Every new membership (quick-add `POST /bookmarks?collection=`, `PUT /bookmarks/{id}/collections`, `POST /bookmarks/bulk` move, `POST /collections/merge`, duplicates resolve, and `POST /data/import`) acquires the caller's `users` row lock (`ChangeLogService.record` or `lockUserForMembershipAppend`) first inside the transaction and computes `nextMembershipOrder` as `COALESCE(MAX("order"), -1) + 1` across **all** memberships in that collection (including trashed bookmarks). Parallel adds never deadlock (`users` → `bookmarks`/`collections` → `bookmark_collections`) and never collide on `(order, sync_seq)`. Existing memberships retain their slots across `PUT /bookmarks/{id}/collections`, `move` (`union`/`assign`), duplicates resolve, and `merge`.
- **Reorder endpoint (`PATCH /api/v1/collections/{id}/bookmarks/order`, `operationId: reorderCollectionBookmarks`):** Accepts `{ items: [{ bookmarkId, order }] }` (1–1000 unique active members, integer `order >= 0`). Unspecified members keep their positions; any unknown, foreign, trashed, or non-member bookmark (or inactive/foreign collection) rejects the whole request with `404` (`400` on duplicate `bookmarkId` or invalid `order`) and zero partial writes. Emits `bookmark:update` change events **only** for memberships whose `order` value actually changed, leaving `bookmarks.updatedAt` untouched so manual dragging does not scramble `sort=updated`.
- **List sorting contract (`GET /api/v1/bookmarks?sort=manual`):** Requires `collectionId` — omitting it returns `400 BAD_REQUEST` (`application/problem+json`) with a clear detail explaining that manual order is collection-scoped (D21). When provided, joins the membership row for `collectionId` and orders by `bc.order ASC NULLS LAST, bc.created_at ASC, b.id ASC`.
- **Trash / restore / purge:** Soft-trashing a bookmark preserves its `bookmark_collections` rows and `order` slots; `POST /bookmarks/{id}/restore` returns it to its prior position in every collection (and concurrent adds while trashed append after the preserved slot). Hard deletion (single `DELETE /bookmarks/{id}` on trashed rows, `bulkBookmarks delete`, `TrashPurgeJob`, or `DELETE /me`) cascades and removes the membership row and its slot.
- **MCP parity (`src/mcp/mcp-tool-catalog.ts`):** Adds `reorderCollectionBookmarks` (mutation, `idempotentHint: true`) and propagates `sort: 'manual'` into `listBookmarks` automatically via DTO schema generation (**40 tools total: 13 reads, 27 mutations**).

## Decisions recorded (M16)

- **Preserving `bookmarks.updatedAt` on manual reorder:** Reordering a bookmark inside a collection updates `bookmark_collections.order` and writes `bookmark:update` to `change_events`, but deliberately does **not** touch `bookmarks.updated_at` so drag-and-drop in one collection never changes `sort=updated` positions or `updatedSince` filters for unrelated collections.
- **Keeping `order` nullable with `DEFAULT 0`:** Existing pre-M16 rows safely start at slot `0` (before newly appended `1, 2, ...` memberships), while keeping the column nullable guarantees `ORDER BY bc_sort.order ASC NULLS LAST` honors both pre-migration `0` rows and any null rows.

## Wave-2 Handoff (for M17+)

M0–M16 are complete and green (**325 unit / 207 e2e tests across 55 test files**). Next is **M17 (Archive & full-text search — D7, D19)**:

- **Per-user full-text & archival search (`D7`):** Only `file:` remains reserved in `src/bookmarks/search-query.parser.ts` (for M18). M17 introduces permanent bookmark archive snapshots (HTML/reader content capture) and PostgreSQL full-text search integration.
- **Standing conventions:** Keep `src/database/entities/index.ts` and `src/database/migrations/index.ts` explicit (no globs), maintain global lock order (`users` row lock first inside `ChangeLogService.transact`), use `queryRows()` for raw `RETURNING` SQL, mirror any new authenticated non-admin REST endpoints in `src/mcp/mcp-tool-catalog.ts`, update `apps/api/README.md`, and run `bun run lint && bun run format:check && bun run typecheck && bun run build && bun run test:unit && bun run test:e2e`.

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
- M7 added `@modelcontextprotocol/sdk` (MCP server + client transports) and
  `class-validator-jsonschema` (DTO → JSON Schema for tool inputs) as
  runtime deps — both `--external` in the build. No new dev deps.
- M6 added NO dependencies — the fetch guard, IP blocklist math, HTML
  parsing and icon ids are all stdlib (`node:dns`, `node:crypto`,
  `node:fs/promises`). The build gained a third entry point
  (`dist/scripts/backfill-metadata.js`); the Dockerfile copies `dist/`
  wholesale, so the container ships it without changes.
