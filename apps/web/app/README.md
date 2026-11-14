# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W5 — Search & filters**. Builds on W0–W4 with operator-grade M11 search (`SearchBar` with 250ms debounce, live grammar cheatsheet `Popper` + `#tag` autocomplete, inline 400 reserved/unknown-operator errors), composable filters (`FilterChipsBar`: `type`, `tag` autocomplete, `favorite`, `notag`, `broken`, `file`, `created` date range, `match:OR` toggle, and removable chips), URL-shareable state (`useUrlState` + `searchFilters` persisting `view`, `sort`, `layout`, and all filter/search params with browser Back/Forward support), card tag-chip filtering, and `SearchEmptyState` with grammar hints.

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
│  ├─ client.ts           # Resilient fetch wrapper (in-memory tokens, single-flight refresh, problem+json)
│  ├─ sync-engine.ts      # Real-time sync engine (bootstrap, WS ticket, deltas, reminder frames, polling fallback, resync, filtered active-view resolution)
│  ├─ endpoints/
│  │  ├─ auth.ts          # /api/v1/auth/* endpoint methods
│  │  ├─ bookmarks.ts     # /api/v1/bookmarks* create, CRUD, replaceTags, collection membership/bulk, icon URL helpers
│  │  ├─ collections.ts   # /api/v1/collections* tree, CRUD, order, manual bookmark order, share, merge
│  │  ├─ highlights.ts    # /api/v1/bookmarks/:id/highlights & /api/v1/highlights/:id CRUD
│  │  ├─ notifications.ts # /api/v1/notifications list + mark read (one/all)
│  │  ├─ sync.ts          # /api/v1/sync/{state,changes,ticket} methods
│  │  └─ tags.ts          # /api/v1/bookmarks/tags list & /api/v1/tags/:name rename/merge/delete-detach
│  └─ schemas/
│     ├─ problem.ts       # RFC 7807 problem+json schema + ApiError class & guards
│     ├─ auth.ts          # Auth request/response Zod boundary schemas + LoginOutcome
│     ├─ bookmarks.ts     # Bookmark, TagUsage, Highlight, Bulk & Membership Zod schemas
│     ├─ collections.ts   # Collection, CollectionNode, Share, Order & Merge Zod schemas
│     ├─ notifications.ts # Notification, NotificationPayload, List & MarkRead Zod schemas
│     └─ sync.ts          # SyncState, SyncTicket, SyncChange, WS frame Zod schemas
├─ stores/
│  ├─ authStore.ts        # Authentication state, in-memory token wiring, sync cleanup on logout/expiry
│  ├─ uiStore.ts          # Snackbar queue & dialog state
│  ├─ syncStore.ts        # Sync connectionState ('live' | 'polling' | 'offline'), cursor, sync flags
│  ├─ libraryStore.ts     # Single client cache (WD1): bookmarks, collections, tags, highlights, filtered views, searchError, selection
│  └─ notificationsStore.ts # Notifications inbox items, unreadCount, drawerOpen, needsRefresh
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
│  ├─ AppLayout.tsx       # Authenticated shell, live SearchBar, unified DndContext, sidebar (collections + Manage tags), notifications, quick-add
│  ├─ guards.tsx          # RequireAuth, RequireAdmin, PublicOnly route wrappers
│  ├─ redirect.ts         # Safe post-login return-URL resolver
│  ├─ routes.tsx          # Lazy-loaded route table (including /quick-add query-param route)
│  └─ strings.ts          # Central shell UI strings (WD3)
├─ theme/
│  ├─ theme.ts            # Single ThemeId -> ThemeDefinition registry
│  ├─ palettes/           # light.ts & dark.ts PaletteOptions
│  ├─ typography.ts       # Shared typography tokens
│  ├─ shape.ts            # Shared border radius / shape tokens
│  ├─ components.ts       # Shared MUI component defaultProps & styleOverrides
│  └─ ThemeController.tsx # MUI ThemeProvider (cssVariables: true) + LocalizationProvider (AdapterDayjs) + hook
├─ shared/
│  ├─ strings.ts          # Central shared bookmark, collection, tag, notification, quick-add, search & filter UI copy (WD3)
│  ├─ components/         # Cross-page MUI components: AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher, SyncStatusIndicator, SearchBar, FilterChipsBar, SearchEmptyState, BookmarkIconBadge, BookmarkLayouts (with ReminderBadge & TagChipList), ContentTypeChip, ContentTypeIcon, FavoriteToggleButton, TagChipList, TagAutocompleteInput, TagManagerDialog, MarkdownPreview, NotificationsDrawer, QuickAddDialog, ReminderBadge, CollectionTreeSidebar, CollectionFormDialog, CollectionDeleteDialog, CollectionShareDialog, CollectionMergeDialog
│  ├─ hooks/              # Cross-page hooks (`useAppDnd.ts`, `useUrlState.ts`)
│  ├─ utils/              # Cross-page pure helpers (`collectionTree.ts`, `searchFilters.ts`)
│  └─ actions/            # Cross-page optimistic mutations (`bookmarkActions.ts`, `collectionActions.ts`, `tagActions.ts`, `highlightActions.ts`, `notificationActions.ts`)
├─ test/
│  ├─ setup.ts            # Vitest setup (RTL matchers, MSW server, FakeWebSocket install, macrotask teardown flush, store/engine resets)
│  ├─ waiters.ts          # Readiness waiters (`waitForBootstrapReady`, `waitForLibraryReady`, `waitForCollectionReady`)
│  ├─ msw/
│  │  ├─ handlers.ts      # Default auth, library, collection, tag, highlight, notification & sync MSW handlers + fixture factories
│  │  └─ server.ts        # msw/node setupServer instance
│  └─ ws/
│     └─ fake-ws.ts       # FakeWebSocket + FakeWebSocketController for deterministic sync & reminder testing
└─ pages/
   ├─ LibraryPage/        # 4 layouts (shared BookmarkLayouts), sort, scope tabs, FilterChipsBar, SearchEmptyState, load-more paging
   ├─ CollectionPage/     # /collections/:collectionId scoped library, breadcrumbs, FilterChipsBar, SearchEmptyState, sort=manual drag/arrow reorder
   ├─ BookmarkDetail/     # /bookmarks/:bookmarkId right-hand MUI Drawer (fields, MarkdownNoteEditor, TagAutocompleteInput, ReminderSection, HighlightsSection, trash/restore)
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}` (plus page-private components/hooks under that folder).
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,utils,actions}/`.

## Library Cache, Sync Engine, Item Richness, Search & W6 Handoff Notes

- **Single client cache (`useLibraryStore` — WD1)**:
  - Stores normalized entities (`bookmarksById`, `collectionsById`, `tagsById`, `highlightsByBookmarkId`, `highlightsLoadedByBookmarkId`, `stats`), per-view paginated ID lists (`views[viewKey]`, supporting both unfiltered `library|sort` / `collection:<id>|sort` keys and filtered `?search=...` view keys parsed via `parseViewKey`), `layoutMode` (`'list' | 'grid' | 'headlines' | 'moodboard'`), `searchError` (for 400 search syntax/operator errors), `expandedCollectionIds` (`arcdrop.collectionTree.expanded`), `selectedBookmarkIds` (consumed by W7 bulk actions), and `pendingOptimistic` snapshots for instant rollback on mutation failure.
  - Filtered views (`parseViewKey(key).hasFilters === true`) keep server-fetched membership authoritative (`viewMatchesBookmark` returns `false`, `insertBookmarkIntoViews` preserves items unless trashed, and `addBookmarkToCollectionViews` skips filtered views).
  - **Do not write to `localStorage` automatically on initial mount** (W1's `LoginPage` suite asserts `localStorage.length === 0` after login). `syncExpandedFromStorage()` only reads `localStorage.getItem`; `localStorage.setItem` runs strictly on explicit user expand/collapse or collection nesting interactions.
- **Search & Composable Filters (W5)**:
  - `src/shared/utils/searchFilters.ts` + `src/shared/hooks/useUrlState.ts` synchronize `view`, `sort`, `layout`, and all filter parameters (`search`, `type`, repeated `tag`, `favorite`, `notag`, `broken`, `file`, `createdFrom`, `createdTo`, `match=OR`) with React Router `useSearchParams` (Back/Forward and direct URL sharing work identically on `/` and `/collections/:collectionId`).
  - `buildBookmarkApiQuery` maps single-tag chips (`tags.length === 1`) to REST `tag=<name>`, multi-tag selections into M11 `#tag` / `#"quoted tag"` tokens inside `search`, boolean REST params (`type`, `favorite`, `broken`, `file`, `collectionId`, `unassignedOnly`), and M11 grammar filters (`match:OR`, `notag:true`, `created:>=YYYY-MM-DD`, `created:<=YYYY-MM-DD`) into `search`, composing `AND` with collection/view scope.
  - `SearchBar` (`src/shared/components/SearchBar.tsx`) provides a 250ms debounced input, Enter immediate submit, Clear button, `Popper` (`disablePortal`) cheatsheet + live `#tag` prefix suggestions, and inline `<Alert data-testid="search-inline-error">` for HTTP 400 `RESERVED_OPERATOR` / unknown-operator responses. Both `sync-engine.ts` (`fetchActiveListWithSearchFallback`) and `useLibraryView` / `useCollectionView` catch 400 search errors without dropping sync state to `offline`.
  - Clicking a `#tag` chip on any card in `BookmarkLayouts` invokes `toggleTag`, and when `hasSearchOrFilters` is active on `CollectionPage`, `sort=manual` drag/move sorting is disabled while filtering.
- **Tags, Highlights, Markdown Notes & Reminders (W4 — WD4)**:
  - `ThemeController` mounts `@mui/x-date-pickers`' `<LocalizationProvider dateAdapter={AdapterDayjs}>` at the provider root so `DateTimePicker` works in every route and test harness.
  - `MarkdownPreview` (`src/shared/components/MarkdownPreview.tsx`) maps `react-markdown` elements exclusively to MUI components (`Typography`, `Link`, `Box`, `Paper`, `Divider`) to comply with `react/forbid-elements` and active light/dark theme tokens.
  - `useNotificationsStore` tracks `items`, `unreadCount`, `drawerOpen`, and `needsRefresh`. On WS `{ type: 'reminder' }` frames, `syncEngine` both enqueues the snackbar alert and increments `unreadCount` + sets `needsRefresh = true` so opening `NotificationsDrawer` fetches fresh server notifications (`GET /api/v1/notifications`).
  - `/quick-add` renders inside the authenticated `AppLayout` shell, parsing `?url`, `?title`, `?collection` (matched by id or case-insensitive title once collections hydrate), `?tags` (comma-separated or repeated params), and `?favorite` (`true`/`1`) into `QuickAddDialog`. Submitting calls `createBookmarkAction` (`POST /bookmarks?collection=...` followed by `PUT /bookmarks/:id/tags` when tags are present) and preserves D13 duplicate-URL support.
- **Unified Drag-and-Drop (`AppLayout` + `useAppDnd` + `BookmarkLayouts` + `CollectionTreeSidebar` — WD4)**:
  - `AppLayout` hosts a single `<DndContext>` + `<DragOverlay>` coordinating drags across `BookmarkLayouts` and `CollectionTreeSidebar`.
  - Note: `AppLayout` renders the mobile drawer with `enableDnd={false}` and desktop drawer with `enableDnd={true}` to prevent duplicate `@dnd-kit` droppable/draggable IDs across MUI's mounted drawers.
  - `CollectionPage` also wraps `BookmarkLayouts` in a fallback `<DndContext>` when rendered outside `AppLayout` (`!hasProvider`).
- **Collection count reconciliation (`CollectionSnapshot` caveat)**:
  - Because `CollectionSnapshotDto` in sync events omits `bookmarkCount`, `collectionActions.ts` reconciles multi-row mutations (cascade delete, merge, bookmark-to-collection membership add/replace) via `refreshCollectionsTreeAction()` (`GET /collections/tree`) alongside bookmark `stats` refresh.
- **Handoff for W6 (Files & Archive Reader)**:
  - File-backed bookmarks already hydrate into `Bookmark` (`storageKind: 'file'`, `fileRef`, `fileName`, `fileMime`, `fileSize`) and `FilterChipsBar` already exposes `file=true` (`Files`) filtering. Check `apps/api/README.md` + generated `src/api/types.ts` for multipart file upload (`POST /bookmarks/files`), authenticated blob download (`GET /bookmarks/:id/file` or file ref endpoint), archive retrieval (`GET /bookmarks/:id/archive`), and reindex endpoints (`POST /bookmarks/:id/archive/reindex` or `cache` reindex).
  - For the archive reader HTML view in `BookmarkDetail`, render archived HTML inside a sandboxed `<Box component="iframe" srcDoc={html} sandbox="" ... />` (wait — verify `sandbox=""` without `allow-scripts`, and use MUI `<Box component="iframe">` to satisfy `react/forbid-elements`!).
  - When `storageKind === 'file'` in `BookmarkDetail`, hide/disable URL editing and expose download + file metadata; keep `cacheStatus` chip (`pending | ready | failed | invalid-origin | skipped`) refreshable and test with `src/test/waiters.ts`.

## Testing, MSW & Fake WebSocket Patterns (`src/test/`)

- **Readiness waiters (`src/test/waiters.ts`)**: All integration tests rendering authenticated routes MUST await `waitForBootstrapReady()`, `waitForLibraryReady()`, or `waitForCollectionReady()` before interacting or asserting so bootstrap/skeleton loading never races renders.
- **MSW v2 (`msw@^2.15.0`) + FakeWebSocket**: `src/test/setup.ts` installs `FakeWebSocket` (`src/test/ws/fake-ws.ts`) on `globalThis.WebSocket` (`autoOpen = true` by default so shell/routing tests reach `'live'` cleanly), registers default `authHandlers`, `libraryHandlers`, and `syncHandlers`, and runs a deterministic async teardown sequence (`cleanup()` -> `syncEngine.stop()` -> `testFakeWsController.reset()` -> `vi.clearAllTimers()` / `vi.useRealTimers()` -> macrotask flush -> `server.resetHandlers()` -> store resets) to prevent dangling promises across tests.
- Note on `SnackbarHost` tests: `SnackbarHost` displays one queued snackbar at a time (`autoHideDuration` default 5000ms); if a test triggers an earlier toast (e.g. a live reminder) and then checks a subsequent toast without fake timers, dismiss the active Alert (`Close` button) first.
- Sync engine unit tests (`src/api/sync-engine.test.ts`) instantiate isolated `createSyncEngine({ client, WebSocketCtor })` instances with `autoOpen: false` to test ticket URLs, delta/tombstone ordering, `resyncRequired`, and `live -> polling -> offline -> live` transitions deterministically.

## Theming & UI Rules (`src/theme/`, ESLint)

- **CSS-variables theming**: Always use semantic MUI palette tokens (`text.secondary`, `background.paper`, `action.hover`, `alpha(theme.palette.<semantic>.main, ...)`, etc.) — never hardcode hex/RGB colors.
- **Strings discipline (WD3)**: Keep all user-facing copy in `src/app/strings.ts`, `src/shared/strings.ts`, and `src/pages/<PageName>/strings.ts`.
- **No-Raw-HTML Rule (`react/forbid-elements`)**: Raw HTML/SVG host elements (`<div>`, `<span>`, `<a>`, `<button>`, `<img>`, `<svg>`, etc.) are forbidden in `src/`. Always use MUI components (with `component="..."` where needed, e.g. `<Link component={RouterLink}>` or `<IconButton component="a">`).
