# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W7 — Health, bulk & portability**. Builds on W0–W6 with multi-select bulk bookmark editing (`BulkActionToolbar` consuming `libraryStore` selection for `move` union/assign, `addTags`, `removeTags`, `trash`, `restore`, trashed-only permanent `delete`, 500-ID cap guard, result summary, and HTTP `429` `Retry-After` friendly retry) + collection tools (`sort-alphabetical`, `delete-empty`), `HealthPage` (`/health` duplicate-URL grouping with live merged tags preview + resolve flow, broken-links list with reasons, link-check mode note, recheck via `reindexBookmarkAction`, and sync-aware refresh), `PortabilityPage` (`/portability` multipart import wizard with summary table + `409` busy retry, export dialog supporting `json`/`csv`/`html`/`txt` + collection scope + `includeFiles` ZIP, and per-bookmark highlights export), and `TrashPage` (`/trash` retention policy note, browse/load-more, per-item & bulk restore/purge, and purge-all confirmation).

## Scripts

Run from `apps/web/app` (or via `bun --cwd=apps/web/app run <script>` / `bun run web:<script>` from the repo root):

| Script                 | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `bun run dev`          | Start the Vite dev server (`http://localhost:5173`)             |
| `bun run build`        | Build production assets + route-level lazy chunks (`dist/`)     |
| `bun run preview`      | Preview the production build locally                            |
| `bun run lint`         | Run ESLint (repo-root flat config + no-raw-HTML rule)           |
| `bun run typecheck`    | Strict TypeScript check (`tsc --noEmit`)                        |
| `bun run test`         | Run Vitest + Testing Library + MSW unit/component suite once    |
| `bun run generate:api` | Fetch `/openapi.json` from `apps/api` and regenerate `types.ts` |

### Regenerating OpenAPI Types (`src/api/types.ts`)

`src/api/types.ts` is generated from `apps/api`'s live OpenAPI document — **do not hand-edit `types.ts`**.

1. Start `apps/api` locally (default base URL `http://localhost:3000`, e.g., via `docker compose up -d --build` or `bun --cwd=apps/api run dev`), or point `ARCDROP__API_URL` / `OPENAPI_URL` at a running API instance.
2. Run:
   ```sh
   ARCDROP__API_URL=http://localhost:3000 bun --cwd=apps/web/app run generate:api
   ```
3. Commit the updated `src/api/types.ts`.

`scripts/generate-api.ts` normalizes two Swagger generation quirks in memory before invoking `openapi-typescript` (without modifying `apps/api`): it disambiguates duplicate `operationId`s emitted by NestJS `@All('mcp')` (`${operationId}_${method}`), and injects missing `TagSnapshotDto` / `CollectionSnapshotDto` component stubs referenced by `SyncChangeDto.snapshot`.

## Architecture & Folder Contract

The codebase enforces strict page-colocation boundaries:

```text
apps/web/app/src/
├─ main.tsx               # React root mount
├─ vite-env.d.ts          # Vite client & VITE_API_URL env types
├─ api/
│  ├─ types.ts            # Generated OpenAPI paths & components (openapi-typescript)
│  ├─ client.ts           # Resilient fetch wrapper (in-memory tokens, single-flight refresh, FormData multipart, getBlob/postBlob + Content-Disposition & Retry-After parsers, problem+json)
│  ├─ sync-engine.ts      # Real-time sync engine (bootstrap, WS ticket, deltas, reminder frames, polling fallback, resync, filtered active-view resolution)
│  ├─ endpoints/
│  │  ├─ auth.ts          # /api/v1/auth/* endpoint methods
│  │  ├─ bookmarks.ts     # /api/v1/bookmarks* CRUD, bulk, uploadFile, getFileBlob (/files/:id), getArchive, reindex, replaceTags, collection membership, icon URL helpers
│  │  ├─ collections.ts   # /api/v1/collections* tree, CRUD, order, manual bookmark order, share, merge, sortAlphabetical, deleteEmpty
│  │  ├─ health.ts        # /api/v1/library/duplicates & /api/v1/library/duplicates/resolve
│  │  ├─ highlights.ts    # /api/v1/bookmarks/:id/highlights, /highlights/export, & /api/v1/highlights/:id CRUD
│  │  ├─ notifications.ts # /api/v1/notifications list + mark read (one/all)
│  │  ├─ portability.ts   # /api/v1/data/import (multipart) & /api/v1/data/export (blob)
│  │  ├─ settings.ts      # /api/v1/admin/settings (GET + PUT)
│  │  ├─ sync.ts          # /api/v1/sync/{state,changes,ticket} methods
│  │  └─ tags.ts          # /api/v1/bookmarks/tags list & /api/v1/tags/:name rename/merge/delete-detach
│  └─ schemas/
│     ├─ problem.ts       # RFC 7807 problem+json schema (quota metadata + retryAfterSeconds) + ApiError class & guards
│     ├─ auth.ts          # Auth request/response Zod boundary schemas + LoginOutcome
│     ├─ bookmarks.ts     # Bookmark, BookmarkArchive, ReindexBookmarkResponse, UploadBookmarkFileInput, TagUsage, Highlight, Bulk (500-ID cap) & Membership Zod schemas
│     ├─ collections.ts   # Collection, CollectionNode, Share, Order, Merge, Sort & DeleteEmpty Zod schemas
│     ├─ health.ts        # DuplicateGroup, FindDuplicatesResponse, ResolveDuplicatesRequest/Response Zod schemas
│     ├─ notifications.ts # Notification, NotificationPayload, List & MarkRead Zod schemas
│     ├─ portability.ts   # ImportSummary, ImportSkippedItem, ImportErrorItem, ExportDataRequest Zod schemas
│     ├─ settings.ts      # Settings & UpdateSettingsRequest Zod schemas
│     └─ sync.ts          # SyncState, SyncTicket, SyncChange, WS frame Zod schemas
├─ stores/
│  ├─ authStore.ts        # Authentication state, in-memory token wiring, sync cleanup on logout/expiry
│  ├─ uiStore.ts          # Snackbar queue & dialog state
│  ├─ syncStore.ts        # Sync connectionState ('live' | 'polling' | 'offline'), cursor, sync flags
│  ├─ libraryStore.ts     # Single client cache (WD1): bookmarks, collections, tags, highlights, filtered views, searchError, selection
│  └─ notificationsStore.ts # Notifications inbox items, unreadCount, drawerOpen, needsRefresh
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
│  ├─ AppLayout.tsx       # Authenticated shell, live SearchBar, unified DndContext, sidebar (collections + Manage tags), notifications, QuickAddDialog, UploadFileDialog
│  ├─ guards.tsx          # RequireAuth, RequireAdmin, PublicOnly route wrappers
│  ├─ redirect.ts         # Safe post-login return-URL resolver
│  ├─ routes.tsx          # Lazy-loaded route table (including /quick-add query-param route)
│  └─ strings.ts          # Central shell UI strings (WD3)
├─ theme/
│  ├─ theme.ts            # Single ThemeId -> ThemeDefinition registry (built-ins compose the selected color palette)
│  ├─ palettes/           # Material You color palettes: `materialYou.ts` (M3 seed schemes + semantic tones) & `index.ts` (palette registry + buildPaletteOptions)
│  ├─ typography.ts       # Shared typography tokens (Onest)
│  ├─ shape.ts            # Shared border radius / shape tokens (M3 base)
│  ├─ components.ts       # Shared MUI component defaultProps & styleOverrides (M3 shapes + `tonal` Button variant)
│  └─ ThemeController.tsx # MUI ThemeProvider (cssVariables: true) + theme/palette preference persistence + hook
├─ shared/
│  ├─ strings.ts          # Central shared bookmark, bulk, cacheStatus, upload, collection, tag, notification, quick-add, search & filter UI copy (WD3)
│  ├─ components/         # Cross-page MUI components: AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher, SyncStatusIndicator, SearchBar, FilterChipsBar, SearchEmptyState, BookmarkIconBadge, AuthenticatedFilePreview, CacheStatusChip, BookmarkLayouts, BulkActionToolbar, ContentTypeChip, ContentTypeIcon, FavoriteToggleButton, TagChipList, TagAutocompleteInput, TagManagerDialog, MarkdownPreview, NotificationsDrawer, QuickAddDialog, UploadFileDialog, ReminderBadge, CollectionTreeSidebar, CollectionFormDialog, CollectionDeleteDialog, CollectionShareDialog, CollectionMergeDialog
│  ├─ hooks/              # Cross-page hooks (`useAppDnd.ts`, `useUrlState.ts`)
│  ├─ utils/              # Cross-page pure helpers (`blobDownload.ts`, `collectionTree.ts`, `searchFilters.ts`, `fileFormat.ts`)
│  └─ actions/            # Cross-page optimistic mutations (`bookmarkActions.ts`, `bulkActions.ts`, `collectionActions.ts`, `tagActions.ts`, `highlightActions.ts`, `notificationActions.ts`)
├─ test/
│  ├─ setup.ts            # Vitest setup (RTL matchers, MSW server, multipart FormData fetch serializer preserving filenames, FakeWebSocket install, macrotask teardown flush, store/engine resets)
│  ├─ waiters.ts          # Readiness waiters (`waitForBootstrapReady`, `waitForLibraryReady`, `waitForCollectionReady`, `waitForHealthReady`, `waitForPortabilityReady`, `waitForTrashReady`)
│  ├─ msw/
│  │  ├─ handlers.ts      # Default auth, library, bulk, health/duplicates, portability, settings, file/archive, collection, tag, highlight, notification & sync MSW handlers + fixture factories
│  │  └─ server.ts        # msw/node setupServer instance
│  └─ ws/
│     └─ fake-ws.ts       # FakeWebSocket + FakeWebSocketController for deterministic sync & reminder testing
└─ pages/
   ├─ LibraryPage/        # 4 layouts (shared BookmarkLayouts), BulkActionToolbar, sort, scope tabs, FilterChipsBar, SearchEmptyState, load-more paging
   ├─ CollectionPage/     # /collections/:collectionId scoped library, BulkActionToolbar, breadcrumbs, FilterChipsBar, SearchEmptyState, sort=manual drag/arrow reorder
   ├─ BookmarkDetail/     # /bookmarks/:bookmarkId right-hand MUI Drawer (Details | Archive tabs via ?tab=archive&view=text|html, BookmarkDetailForm with file preview/download & readonly file URL, BookmarkArchivePanel with sandboxed iframe & Reindex, MarkdownNoteEditor, TagAutocompleteInput, ReminderSection, HighlightsSection, trash/restore)
   ├─ HealthPage/         # /health duplicate groups side-by-side + merged tags/membership preview + resolve flow, broken links + mode note + recheck via reindex, sync-aware refresh
   ├─ PortabilityPage/    # /portability multipart import wizard + summary table + 409 busy retry, export dialog (format/scope/includeFiles), per-bookmark highlights export
   ├─ TrashPage/          # /trash retention note, trashed list + BulkActionToolbar, per-item restore/purge, load-more, purge-all confirmation
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}` (plus page-private components/hooks under that folder).
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,utils,actions}/`.

## Library Cache, Sync Engine, Health, Bulk, Portability & W8 Handoff Notes

- **Single client cache (`useLibraryStore` — WD1)**:
  - Stores normalized entities (`bookmarksById`, `collectionsById`, `tagsById`, `highlightsByBookmarkId`, `highlightsLoadedByBookmarkId`, `stats`), per-view paginated ID lists (`views[viewKey]`, supporting both unfiltered `library|sort` / `collection:<id>|sort` keys and filtered `?search=...` view keys parsed via `parseViewKey`), `layoutMode` (`'list' | 'grid' | 'headlines' | 'moodboard'`), `searchError` (for 400 search syntax/operator errors), `expandedCollectionIds` (`arcdrop.collectionTree.expanded`), `selectedBookmarkIds` (consumed by `BulkActionToolbar`), and `pendingOptimistic` snapshots for instant rollback on mutation failure.
  - Filtered views (`parseViewKey(key).hasFilters === true`) keep server-fetched membership authoritative (`viewMatchesBookmark` returns `false`, `insertBookmarkIntoViews` preserves items unless trashed, and `addBookmarkToCollectionViews` skips filtered views).
  - **Do not write to `localStorage` automatically on initial mount** (W1's `LoginPage` suite asserts `localStorage.length === 0` after login). `syncExpandedFromStorage()` only reads `localStorage.getItem`; `localStorage.setItem` runs strictly on explicit user expand/collapse or collection nesting interactions.
- **Health, Bulk, Portability & Trash (W7)**:
  - **Bulk Toolbar & Collection Tools (`BulkActionToolbar` + `bulkActions.ts` + `CollectionTreeSidebar`)**: Consumes `selectedBookmarkIds` on `LibraryPage`, `CollectionPage`, and `TrashPage`. Supports `move` (`union` / `assign` collections), `addTags`, `removeTags`, `trash`, `restore`, and trashed-only permanent `delete` (button disabled when active items are selected + explicit hint + `409` surface fallback). Enforces the 500-ID request cap (`MAX_BULK_BOOKMARK_IDS = 500`), prints action summary alerts, and handles `429` responses via `ApiError.retryAfterSeconds` with an inline Retry banner. `CollectionTreeSidebar` also exposes a Collection tools menu for `POST /collections/sort-alphabetical` and `POST /collections/delete-empty`.
  - **HealthPage (`/health`)**: Displays duplicate-URL groups (`GET /library/duplicates`) side-by-side (`original` vs `extras`), lets the user pick any candidate to keep and which others to trash, previews the merged union of tags and notes collection membership merging, and submits `POST /library/duplicates/resolve` through `useLibraryStore` + sync/stats/tags/tree reconciliation. The `Broken links` tab queries `GET /bookmarks?broken=true`, surfaces `brokenReason` and check mode (`GET /admin/settings` for `admin`, default fallback note for non-admin users), and triggers `reindexBookmarkAction` to recheck a link. Sync cursor advances automatically refresh `HealthPage` (waiting until `syncEngine` completes initial bootstrap so `/health` never double-fetches on mount).
  - **PortabilityPage (`/portability`)**: Provides a multipart file upload wizard (`POST /data/import` via `FormData`), handles `409` concurrent-import conflict with a one-click Retry banner, and renders a summary panel + table for `created`, `updated`, `skipped[]`, and `errors[]`. Export uses `ExportDialog` (`POST /data/export` via `apiClient.postBlob` + `triggerBlobDownload`) with `json`/`csv`/`html`/`txt`, collection scope, and `includeFiles` (ZIP bundle), plus a per-bookmark Highlights Export card (`GET /bookmarks/:id/highlights/export?format=txt|csv`).
  - **TrashPage (`/trash`)**: Queries `GET /bookmarks?trashed=true`, displays retention policy notice (`GET /admin/settings` for admins, standard 30-day default note for non-admins), supports per-item `Restore` / `Delete permanently` (with confirmation), bulk `Restore` / `Delete permanently`, `Load more` pagination, and `Purge all` confirmation dialog.
- **Files & Archive Reader (W6)**:
  - `UploadFileDialog` + `bookmarksApi.uploadFile` + `AuthenticatedFilePreview` + `BookmarkArchivePanel` (sandboxed iframe `<Box component="iframe" srcDoc={archive.html} sandbox="" />`, plain-text toggle, `CacheStatusChip`, `POST /bookmarks/:id/reindex`). Shared blob download helper now lives in `src/shared/utils/blobDownload.ts`.
- **Search & Composable Filters (W5)**, **Tags, Highlights, Markdown Notes & Reminders (W4)**, **Unified DnD (`AppLayout` + `useAppDnd`)**:
  - See W4–W6 modules; `CollectionTreeSidebar` and `useAppDnd` handle cross-tree/bookmark drags.
- **Handoff for W8 (Settings, Admin & Public Share)**:
  - `src/api/schemas/settings.ts` and `src/api/endpoints/settings.ts` (`settingsApi.get()` / `settingsApi.update()`) already exist from W7 and are covered by default MSW handlers. Remember `GET /api/v1/admin/settings` is **admin-only** on the backend — non-admin routes like `SettingsPage` should not assume `settingsApi.get()` succeeds for `'user'` roles.
  - **`SettingsPage` (`/settings`)**: User account overview, change password (`POST /auth/password`), TOTP setup/enable/disable with recovery codes (`POST /auth/tfa/{setup,enable,disable}`), active sessions list & revoke (`GET/DELETE /auth/sessions`), and theme switcher integration.
  - **`AdminPage` (`/admin`, `RequireAdmin`)**: Server settings form (`settingsApi.get/update`: registration open, retention days, broken-link check mode, archive/file size caps, monthly upload quota), users list/invite/role/status management, and server audit/stats controls from `types.ts` / `apps/api/README.md`.
  - **`PublicSharePage` (`/s/:token`, public route)**: Public shared collection viewer (`GET /api/v1/public/collections/:token`), item list/read-only view, and RSS link (`/api/v1/public/collections/:token/rss`) without requiring auth tokens.

## Testing, MSW & Fake WebSocket Patterns (`src/test/`)

- **Readiness waiters (`src/test/waiters.ts`)**: All integration tests rendering authenticated routes MUST await `waitForBootstrapReady()`, `waitForLibraryReady()`, `waitForCollectionReady()`, `waitForHealthReady()`, `waitForPortabilityReady()`, or `waitForTrashReady()` before interacting or asserting so bootstrap/skeleton loading never races renders.
- **Waiter pattern for sync-cursor tests**: When overriding `GET /api/v1/sync/changes` to test cursor-driven page refreshes (e.g. `HealthPage`), keep returning the initial cursor (`'10'`) until after initial assertions finish — because `FakeWebSocket` (`autoOpen: true`) triggers an immediate `sync/changes` pull upon opening.
- **MSW v2 (`msw@^2.15.0`) + FakeWebSocket**: `src/test/setup.ts` installs `FakeWebSocket` (`src/test/ws/fake-ws.ts`) on `globalThis.WebSocket` (`autoOpen = true` by default so shell/routing tests reach `'live'` cleanly), registers default `authHandlers`, `libraryHandlers`, and `syncHandlers`, and runs a deterministic async teardown sequence to prevent dangling promises across tests.

## Theming & UI Rules (`src/theme/`, ESLint)

- **Material You (M3) theming**: The visual language is Material You — Onest typeface, pill buttons, 20px cards, 28px dialogs, tonal selections (`components.ts`), and M3 tonal palettes mapped onto MUI roles (`palettes/materialYou.ts`).
- **Selectable color palettes**: Users pick a color palette (Violet, Ocean, Indigo, Teal, Forest, Sunset, Amber, Rose, Crimson, Graphite mono, AMOLED true-black mono) from the `ThemeSwitcher` palette section; it recolors light & dark themes without touching shape/typography. Mode persists under `arcdrop.theme` (`light`/`dark`), palette under `arcdrop.palette` (default `violet`). `<html data-theme data-palette>` exposes both for CSS.
- **CSS-variables theming**: Always use semantic MUI palette tokens (`text.secondary`, `background.paper`, `action.hover`, `alpha(theme.palette.<semantic>.main, ...)`, etc.) - never hardcode hex/RGB colors.
- **Strings discipline (WD3)**: Keep all user-facing copy in `src/app/strings.ts`, `src/shared/strings.ts`, and `src/pages/<PageName>/strings.ts`.
- **No-Raw-HTML Rule (`react/forbid-elements`)**: Raw HTML/SVG host elements (`<div>`, `<span>`, `<a>`, `<button>`, `<img>`, `<svg>`, etc.) are forbidden in `src/`. Always use MUI components (`<Link component={RouterLink}>`, `<Box component="iframe">`, etc.).
