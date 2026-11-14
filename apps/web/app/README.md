# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W6 â€” Files & archive reader**. Builds on W0â€“W5 with first-class file-backed items (`UploadFileDialog` with drag-and-drop/file picker, metadata, progress indicator, and structured 413/415/quota error rendering with `limitBytes`/`usedBytes`/`resetAt`), authenticated blob preview & download (`client.getBlob` + `parseContentDispositionFilename`, `AuthenticatedFilePreview`, type-aware rendering across all 4 layouts + `file:` filter integration), and an in-drawer archive reader (`BookmarkDetail` `Details` | `Archive` tabs synced via `?tab=archive&view=text|html`, sandboxed HTML `<Box component="iframe" srcDoc={...} sandbox="" />`, plain-text fallback, `CacheStatusChip` across all 5 states, and `POST /bookmarks/:id/reindex`).

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

`src/api/types.ts` is generated from `apps/api`'s live OpenAPI document â€” **do not hand-edit `types.ts`**.

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
â”œâ”€ main.tsx               # React root mount
â”œâ”€ vite-env.d.ts          # Vite client & VITE_API_URL env types
â”œâ”€ api/
â”‚  â”œâ”€ types.ts            # Generated OpenAPI paths & components (openapi-typescript)
â”‚  â”œâ”€ client.ts           # Resilient fetch wrapper (in-memory tokens, single-flight refresh, FormData multipart, getBlob + Content-Disposition parser, problem+json)
â”‚  â”œâ”€ sync-engine.ts      # Real-time sync engine (bootstrap, WS ticket, deltas, reminder frames, polling fallback, resync, filtered active-view resolution)
â”‚  â”œâ”€ endpoints/
â”‚  â”‚  â”œâ”€ auth.ts          # /api/v1/auth/* endpoint methods
â”‚  â”‚  â”œâ”€ bookmarks.ts     # /api/v1/bookmarks* CRUD, uploadFile, getFileBlob (/files/:id), getArchive, reindex, replaceTags, collection membership/bulk, icon URL helpers
â”‚  â”‚  â”œâ”€ collections.ts   # /api/v1/collections* tree, CRUD, order, manual bookmark order, share, merge
â”‚  â”‚  â”œâ”€ highlights.ts    # /api/v1/bookmarks/:id/highlights & /api/v1/highlights/:id CRUD
â”‚  â”‚  â”œâ”€ notifications.ts # /api/v1/notifications list + mark read (one/all)
â”‚  â”‚  â”œâ”€ sync.ts          # /api/v1/sync/{state,changes,ticket} methods
â”‚  â”‚  â””â”€ tags.ts          # /api/v1/bookmarks/tags list & /api/v1/tags/:name rename/merge/delete-detach
â”‚  â””â”€ schemas/
â”‚     â”œâ”€ problem.ts       # RFC 7807 problem+json schema (including quota limitBytes/usedBytes/resetAt) + ApiError class & guards
â”‚     â”œâ”€ auth.ts          # Auth request/response Zod boundary schemas + LoginOutcome
â”‚     â”œâ”€ bookmarks.ts     # Bookmark, BookmarkArchive, ReindexBookmarkResponse, UploadBookmarkFileInput, TagUsage, Highlight, Bulk & Membership Zod schemas
â”‚     â”œâ”€ collections.ts   # Collection, CollectionNode, Share, Order & Merge Zod schemas
â”‚     â”œâ”€ notifications.ts # Notification, NotificationPayload, List & MarkRead Zod schemas
â”‚     â””â”€ sync.ts          # SyncState, SyncTicket, SyncChange, WS frame Zod schemas
â”œâ”€ stores/
â”‚  â”œâ”€ authStore.ts        # Authentication state, in-memory token wiring, sync cleanup on logout/expiry
â”‚  â”œâ”€ uiStore.ts          # Snackbar queue & dialog state
â”‚  â”œâ”€ syncStore.ts        # Sync connectionState ('live' | 'polling' | 'offline'), cursor, sync flags
â”‚  â”œâ”€ libraryStore.ts     # Single client cache (WD1): bookmarks, collections, tags, highlights, filtered views, searchError, selection
â”‚  â””â”€ notificationsStore.ts # Notifications inbox items, unreadCount, drawerOpen, needsRefresh
â”œâ”€ app/
â”‚  â”œâ”€ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
â”‚  â”œâ”€ AppLayout.tsx       # Authenticated shell, live SearchBar, unified DndContext, sidebar (collections + Manage tags), notifications, QuickAddDialog, UploadFileDialog
â”‚  â”œâ”€ guards.tsx          # RequireAuth, RequireAdmin, PublicOnly route wrappers
â”‚  â”œâ”€ redirect.ts         # Safe post-login return-URL resolver
â”‚  â”œâ”€ routes.tsx          # Lazy-loaded route table (including /quick-add query-param route)
â”‚  â””â”€ strings.ts          # Central shell UI strings (WD3)
â”œâ”€ theme/
â”‚  â”œâ”€ theme.ts            # Single ThemeId -> ThemeDefinition registry
â”‚  â”œâ”€ palettes/           # light.ts & dark.ts PaletteOptions
â”‚  â”œâ”€ typography.ts       # Shared typography tokens
â”‚  â”œâ”€ shape.ts            # Shared border radius / shape tokens
â”‚  â”œâ”€ components.ts       # Shared MUI component defaultProps & styleOverrides
â”‚  â””â”€ ThemeController.tsx # MUI ThemeProvider (cssVariables: true) + LocalizationProvider (AdapterDayjs) + hook
â”œâ”€ shared/
â”‚  â”œâ”€ strings.ts          # Central shared bookmark, cacheStatus, upload, collection, tag, notification, quick-add, search & filter UI copy (WD3)
â”‚  â”œâ”€ components/         # Cross-page MUI components: AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher, SyncStatusIndicator, SearchBar, FilterChipsBar, SearchEmptyState, BookmarkIconBadge, AuthenticatedFilePreview, CacheStatusChip, BookmarkLayouts (4 layouts + file previews, download action, archive-text links, ReminderBadge, TagChipList), ContentTypeChip, ContentTypeIcon, FavoriteToggleButton, TagChipList, TagAutocompleteInput, TagManagerDialog, MarkdownPreview, NotificationsDrawer, QuickAddDialog, UploadFileDialog, ReminderBadge, CollectionTreeSidebar, CollectionFormDialog, CollectionDeleteDialog, CollectionShareDialog, CollectionMergeDialog
â”‚  â”œâ”€ hooks/              # Cross-page hooks (`useAppDnd.ts`, `useUrlState.ts`)
â”‚  â”œâ”€ utils/              # Cross-page pure helpers (`collectionTree.ts`, `searchFilters.ts`, `fileFormat.ts`)
â”‚  â””â”€ actions/            # Cross-page optimistic mutations (`bookmarkActions.ts`, `collectionActions.ts`, `tagActions.ts`, `highlightActions.ts`, `notificationActions.ts`)
â”œâ”€ test/
â”‚  â”œâ”€ setup.ts            # Vitest setup (RTL matchers, MSW server, multipart FormData fetch serializer preserving filenames, FakeWebSocket install, macrotask teardown flush, store/engine resets)
â”‚  â”œâ”€ waiters.ts          # Readiness waiters (`waitForBootstrapReady`, `waitForLibraryReady`, `waitForCollectionReady`)
â”‚  â”œâ”€ msw/
â”‚  â”‚  â”œâ”€ handlers.ts      # Default auth, library, file/archive, collection, tag, highlight, notification & sync MSW handlers + fixture factories
â”‚  â”‚  â””â”€ server.ts        # msw/node setupServer instance
â”‚  â””â”€ ws/
â”‚     â””â”€ fake-ws.ts       # FakeWebSocket + FakeWebSocketController for deterministic sync & reminder testing
â””â”€ pages/
   â”œâ”€ LibraryPage/        # 4 layouts (shared BookmarkLayouts), sort, scope tabs, FilterChipsBar, SearchEmptyState, load-more paging
   â”œâ”€ CollectionPage/     # /collections/:collectionId scoped library, breadcrumbs, FilterChipsBar, SearchEmptyState, sort=manual drag/arrow reorder
   â”œâ”€ BookmarkDetail/     # /bookmarks/:bookmarkId right-hand MUI Drawer (Details | Archive tabs via ?tab=archive&view=text|html, BookmarkDetailForm with file preview/download & readonly file URL, BookmarkArchivePanel with sandboxed iframe & Reindex, MarkdownNoteEditor, TagAutocompleteInput, ReminderSection, HighlightsSection, trash/restore)
   â””â”€ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}` (plus page-private components/hooks under that folder).
2. Page-local files are **strictly private** to that page â€” another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,utils,actions}/`.

## Library Cache, Sync Engine, Files, Archive Reader & W7 Handoff Notes

- **Single client cache (`useLibraryStore` â€” WD1)**:
  - Stores normalized entities (`bookmarksById`, `collectionsById`, `tagsById`, `highlightsByBookmarkId`, `highlightsLoadedByBookmarkId`, `stats`), per-view paginated ID lists (`views[viewKey]`, supporting both unfiltered `library|sort` / `collection:<id>|sort` keys and filtered `?search=...` view keys parsed via `parseViewKey`), `layoutMode` (`'list' | 'grid' | 'headlines' | 'moodboard'`), `searchError` (for 400 search syntax/operator errors), `expandedCollectionIds` (`arcdrop.collectionTree.expanded`), `selectedBookmarkIds` (consumed by W7 bulk actions), and `pendingOptimistic` snapshots for instant rollback on mutation failure.
  - Filtered views (`parseViewKey(key).hasFilters === true`) keep server-fetched membership authoritative (`viewMatchesBookmark` returns `false`, `insertBookmarkIntoViews` preserves items unless trashed, and `addBookmarkToCollectionViews` skips filtered views).
  - **Do not write to `localStorage` automatically on initial mount** (W1's `LoginPage` suite asserts `localStorage.length === 0` after login). `syncExpandedFromStorage()` only reads `localStorage.getItem`; `localStorage.setItem` runs strictly on explicit user expand/collapse or collection nesting interactions.
- **Files & Archive Reader (W6)**:
  - **Multipart Upload (`UploadFileDialog` + `bookmarksApi.uploadFile` + `uploadBookmarkFileAction`)**: Supports drag-and-drop or hidden file input picker, optional `title`, `collection`, `tags`, and `favorite` metadata, in-flight `<LinearProgress />`, and RFC 7807 `problem+json` error rendering (415 unsupported media type, 413 per-file cap or monthly quota with `usedBytes`, `limitBytes`, and `resetAt`). `bookmarksApi.uploadFile` sends `FormData` without a manual `Content-Type` header so browsers compute the multipart boundary automatically; `test/setup.ts` encodes `FormData` bodies into `multipart/form-data` payloads with explicit filenames to avoid Vitest jsdom `makeCompatFormData` stripping `File.name`.
  - **Authenticated File Previews & Downloads (`apiClient.getBlob` + `AuthenticatedFilePreview` + `downloadBookmarkFileAction`)**: Fetches `GET /api/v1/files/{id}` (`?download=1` for downloads) with `Authorization: Bearer ...` and single-flight 401 refresh. `parseContentDispositionFilename` honors RFC 5987 `filename*=UTF-8''...` and legacy `filename="..."`. `AuthenticatedFilePreview` fetches image blobs into `URL.createObjectURL` with cleanup revoke on unmount/ID change and falls back to `BookmarkIconBadge` on non-image/error states.
  - **All 4 Layouts & File Integration (`BookmarkLayouts` + `fileFormat.ts`)**: `list`, `grid`, `headlines`, and `moodboard` layouts render authenticated image previews for image files, content-type icons for audio/video/document files, formatted filename/size/MIME metadata, authenticated download buttons on cards (`BookmarkPrimaryAction`), and `Archive text` chip links (`/bookmarks/:id?tab=archive&view=text`) for extractable text/document files (`text/*`, markdown, PDF, EPUB).
  - **Archive Reader (`BookmarkDetail` + `BookmarkArchivePanel` + `CacheStatusChip`)**: `BookmarkDetail` exposes `Details` and `Archive` tabs synced with `?tab=archive&view=text|html`. HTML snapshots render strictly inside `<Box component="iframe" srcDoc={archive.html} sandbox="" />` (no `allow-scripts`), with a plain-text toggle fallback and `CacheStatusChip` across all 5 states (`pending`, `ready`, `failed`, `invalid-origin`, `skipped`). Non-file bookmarks support manual `Reindex` (`POST /bookmarks/:id/reindex`), whereas file-backed bookmarks keep URL editing disabled and surface file preview/metadata/download/extracted-text actions.
- **Search & Composable Filters (W5)**:
  - `src/shared/utils/searchFilters.ts` + `src/shared/hooks/useUrlState.ts` synchronize `view`, `sort`, `layout`, and all filter parameters (`search`, `type`, repeated `tag`, `favorite`, `notag`, `broken`, `file`, `createdFrom`, `createdTo`, `match=OR`) with React Router `useSearchParams` (Back/Forward and direct URL sharing work identically on `/` and `/collections/:collectionId`).
  - `buildBookmarkApiQuery` maps single-tag chips (`tags.length === 1`) to REST `tag=<name>`, multi-tag selections into M11 `#tag` / `#\"quoted tag\"` tokens inside `search`, boolean REST params (`type`, `favorite`, `broken`, `file`, `collectionId`, `unassignedOnly`), and M11 grammar filters (`match:OR`, `notag:true`, `created:>=YYYY-MM-DD`, `created:<=YYYY-MM-DD`) into `search`, composing `AND` with collection/view scope.
  - `SearchBar` (`src/shared/components/SearchBar.tsx`) provides a 250ms debounced input, Enter immediate submit, Clear button, `Popper` (`disablePortal`) cheatsheet + live `#tag` prefix suggestions, and inline `<Alert data-testid="search-inline-error">` for HTTP 400 `RESERVED_OPERATOR` / unknown-operator responses.
- **Tags, Highlights, Markdown Notes & Reminders (W4 â€” WD4)**:
  - `ThemeController` mounts `@mui/x-date-pickers`' `<LocalizationProvider dateAdapter={AdapterDayjs}>` at the provider root so `DateTimePicker` works in every route and test harness.
  - `MarkdownPreview` (`src/shared/components/MarkdownPreview.tsx`) maps `react-markdown` elements exclusively to MUI components (`Typography`, `Link`, `Box`, `Paper`, `Divider`) to comply with `react/forbid-elements` and active light/dark theme tokens.
  - `useNotificationsStore` tracks `items`, `unreadCount`, `drawerOpen`, and `needsRefresh`. On WS `{ type: 'reminder' }` frames, `syncEngine` both enqueues the snackbar alert and increments `unreadCount` + sets `needsRefresh = true` so opening `NotificationsDrawer` fetches fresh server notifications (`GET /api/v1/notifications`).
  - `/quick-add` renders inside the authenticated `AppLayout` shell and preserves D13 duplicate-URL support.
- **Unified Drag-and-Drop (`AppLayout` + `useAppDnd` + `BookmarkLayouts` + `CollectionTreeSidebar` â€” WD4)**:
  - `AppLayout` hosts a single `<DndContext>` + `<DragOverlay>` coordinating drags across `BookmarkLayouts` and `CollectionTreeSidebar` (`enableDnd={false}` on mobile drawer to prevent duplicate IDs).
- **Collection count reconciliation (`CollectionSnapshot` caveat)**:
  - Because `CollectionSnapshotDto` in sync events omits `bookmarkCount`, `collectionActions.ts` reconciles multi-row mutations (cascade delete, merge, bookmark-to-collection membership add/replace) via `refreshCollectionsTreeAction()` (`GET /collections/tree`) alongside bookmark `stats` refresh.
- **Handoff for W7 (Health, Bulk & Portability)**:
  - **Multi-select bulk toolbar**: `useLibraryStore` already maintains `selectedBookmarkIds`, `toggleSelectBookmark`, `selectAllInView`, and `clearSelection`, and `bookmarksApi.bulk` + `bulkBookmarksResponseSchema` already exist in `src/api/endpoints/bookmarks.ts` and `src/api/schemas/bookmarks.ts`. Wire a contextual bulk toolbar in `LibraryPage` / `CollectionPage` (and `TrashPage` for `restore`/`delete`) supporting move/add to collection, add/remove tags, trash/restore, trashed-only permanent delete enforcement, partial-failure/result summaries, and graceful HTTP `429` retry-after surfacing.
  - **`HealthPage` (`/health`)**: Implement duplicate-URL groups (`GET /bookmarks/duplicates` + resolve preview/merge endpoint from `types.ts` / `apps/api/README.md`) and broken-links management (`GET /bookmarks?broken=true`, `brokenReason` surfacing, settings link-check mode note, and recheck/reindex triggers reusing `reindexBookmarkAction` / `CacheStatusChip`). Keep `HealthPage` updated on sync events.
  - **`PortabilityPage` (`/portability`)**: Build the import wizard (multipart upload using `FormData`, structured summary table for created/updated/skipped/errors, and HTTP `409` busy retry UX) and export dialog (`apiClient.getBlob` + `parseContentDispositionFilename` for TXT/CSV/HTML/JSON + `includeFiles` + collection scope + highlights export).
  - **`TrashPage` (`/trash`)**: Render trashed bookmarks (`trashed: true`), restore, per-item purge, retention policy note from settings, and purge-all with confirmation.

## Testing, MSW & Fake WebSocket Patterns (`src/test/`)

- **Readiness waiters (`src/test/waiters.ts`)**: All integration tests rendering authenticated routes MUST await `waitForBootstrapReady()`, `waitForLibraryReady()`, or `waitForCollectionReady()` before interacting or asserting so bootstrap/skeleton loading never races renders.
- **MSW v2 (`msw@^2.15.0`) + FakeWebSocket**: `src/test/setup.ts` installs `FakeWebSocket` (`src/test/ws/fake-ws.ts`) on `globalThis.WebSocket` (`autoOpen = true` by default so shell/routing tests reach `'live'` cleanly), registers default `authHandlers`, `libraryHandlers`, and `syncHandlers`, and runs a deterministic async teardown sequence (`cleanup()` -> `syncEngine.stop()` -> `testFakeWsController.reset()` -> `vi.clearAllTimers()` / `vi.useRealTimers()` -> macrotask flush -> `server.resetHandlers()` -> store resets) to prevent dangling promises across tests.
- Note on `SnackbarHost` tests: `SnackbarHost` displays one queued snackbar at a time (`autoHideDuration` default 5000ms); if a test triggers an earlier toast (e.g. a live reminder) and then checks a subsequent toast without fake timers, dismiss the active Alert (`Close` button) first.
- Sync engine unit tests (`src/api/sync-engine.test.ts`) instantiate isolated `createSyncEngine({ client, WebSocketCtor })` instances with `autoOpen: false` to test ticket URLs, delta/tombstone ordering, `resyncRequired`, and `live -> polling -> offline -> live` transitions deterministically.

## Theming & UI Rules (`src/theme/`, ESLint)

- **CSS-variables theming**: Always use semantic MUI palette tokens (`text.secondary`, `background.paper`, `action.hover`, `alpha(theme.palette.<semantic>.main, ...)`, etc.) â€” never hardcode hex/RGB colors.
- **Strings discipline (WD3)**: Keep all user-facing copy in `src/app/strings.ts`, `src/shared/strings.ts`, and `src/pages/<PageName>/strings.ts`.
- **No-Raw-HTML Rule (`react/forbid-elements`)**: Raw HTML/SVG host elements (`<div>`, `<span>`, `<a>`, `<button>`, `<img>`, `<svg>`, etc.) are forbidden in `src/`. Always use MUI components (with `component="..."` where needed, e.g. `<Link component={RouterLink}>`, `<IconButton component="a">`, or `<Box component="iframe">`).
