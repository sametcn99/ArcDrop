# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W4 — Item richness**. Builds on W0–W3 with full item enrichment: tag chip autocomplete & exact-set replacement (`PUT /bookmarks/:id/tags`), sidebar-footer `TagManagerDialog` (rename, merge warning + execution, delete-detach with usage counts), highlight CRUD (`HighlightsSection` with semantic palette colors and trash-state read-only enforcement), Markdown notes (`MarkdownNoteEditor` Edit/Preview toggle rendering `react-markdown` through MUI `Typography`/`Link`/`Paper`/`Divider`), reminders (`@mui/x-date-pickers` `DateTimePicker` set/clear + `ReminderBadge` across all 4 shared `BookmarkLayouts`), live reminder notifications (WS `reminder` frame -> snackbar + unread badge + `NotificationsDrawer` with list & mark-read one/all), and the duplicate-friendly `QuickAddDialog` (AppBar trigger + `/quick-add` query-param route).

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
│  ├─ sync-engine.ts      # Real-time sync engine (bootstrap, WS ticket, deltas, reminder frames, polling fallback, resync)
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
│  ├─ libraryStore.ts     # Single client cache (WD1): bookmarks, collections, tags, highlights, views, selection
│  └─ notificationsStore.ts # Notifications inbox items, unreadCount, drawerOpen, needsRefresh
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
│  ├─ AppLayout.tsx       # Authenticated shell, unified DndContext, sidebar (collections + Manage tags), notifications, quick-add
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
│  ├─ strings.ts          # Central shared bookmark, collection, tag, notification & quick-add UI copy (WD3)
│  ├─ components/         # Cross-page MUI components: AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher, SyncStatusIndicator, BookmarkIconBadge, BookmarkLayouts (with ReminderBadge & TagChipList), ContentTypeChip, ContentTypeIcon, FavoriteToggleButton, TagChipList, TagAutocompleteInput, TagManagerDialog, MarkdownPreview, NotificationsDrawer, QuickAddDialog, ReminderBadge, CollectionTreeSidebar, CollectionFormDialog, CollectionDeleteDialog, CollectionShareDialog, CollectionMergeDialog
│  ├─ hooks/              # Cross-page hooks (`useAppDnd.ts` DndContext coordination & drag/drop ID helpers)
│  ├─ utils/              # Cross-page pure helpers (`collectionTree.ts`)
│  └─ actions/            # Cross-page optimistic mutations (`bookmarkActions.ts`, `collectionActions.ts`, `tagActions.ts`, `highlightActions.ts`, `notificationActions.ts`)
├─ test/
│  ├─ setup.ts            # Vitest setup (RTL matchers, MSW server, FakeWebSocket install, macrotask teardown flush, store/engine resets)
│  ├─ msw/
│  │  ├─ handlers.ts      # Default auth, library, collection, tag, highlight, notification & sync MSW handlers + fixture factories
│  │  └─ server.ts        # msw/node setupServer instance
│  └─ ws/
│     └─ fake-ws.ts       # FakeWebSocket + FakeWebSocketController for deterministic sync & reminder testing
└─ pages/
   ├─ LibraryPage/        # 4 layouts (shared BookmarkLayouts), sort, scope tabs, load-more paging
   ├─ CollectionPage/     # /collections/:collectionId scoped library, breadcrumbs, sort=manual drag/arrow reorder
   ├─ BookmarkDetail/     # /bookmarks/:bookmarkId right-hand MUI Drawer (fields, MarkdownNoteEditor, TagAutocompleteInput, ReminderSection, HighlightsSection, trash/restore)
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}` (plus page-private components/hooks under that folder).
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,utils,actions}/`.

## Library Cache, Sync Engine, Item Richness & W5 Handoff Notes

- **Single client cache (`useLibraryStore` — WD1)**:
  - Stores normalized entities (`bookmarksById`, `collectionsById`, `tagsById`, `highlightsByBookmarkId`, `highlightsLoadedByBookmarkId`, `stats`), per-view paginated ID lists (`views[viewKey]`, supporting both `library:...` and `collection:<id>|<sort>` keys), `layoutMode` (`'list' | 'grid' | 'headlines' | 'moodboard'`), `expandedCollectionIds` (`arcdrop.collectionTree.expanded`), `selectedBookmarkIds` (consumed by W7 bulk actions), and `pendingOptimistic` snapshots for instant rollback on mutation failure.
  - **Do not write to `localStorage` automatically on initial mount** (W1's `LoginPage` suite asserts `localStorage.length === 0` after login). `syncExpandedFromStorage()` only reads `localStorage.getItem`; `localStorage.setItem` runs strictly on explicit user expand/collapse or collection nesting interactions.
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
- **Handoff for W5 (Search & Filters)**:
  - `AppLayout` already renders the global search `TextField` in the `AppBar` (currently `disabled` with `APP_STRINGS.searchPlaceholder` — enable and wire to W5's `/search` route or library search state).
  - Tag autocomplete & usage lists are already hydrated in `useLibraryStore.tagsById` (`selectSortedTags`), and `TagChipList` is rendered on shared cards in `BookmarkLayouts` — clicking a tag chip can be wired to `#tag` / `tags` filter navigation in W5.
  - Note: `src/shared/actions/bookmarkActions.ts` + `src/api/endpoints/bookmarks.ts` already expose `replaceCollections` (`PUT /bookmarks/:id/collections`) and `BookmarkListQuery` supports API query filters (`q`, `tags`, `contentType`, `favorite`, `collectionId`, `trashed`, `unassignedOnly`, `broken`).

## Testing, MSW & Fake WebSocket Patterns (`src/test/`)

- **MSW v2 (`msw@^2.15.0`) + FakeWebSocket**: `src/test/setup.ts` installs `FakeWebSocket` (`src/test/ws/fake-ws.ts`) on `globalThis.WebSocket` (`autoOpen = true` by default so shell/routing tests reach `'live'` cleanly), registers default `authHandlers`, `libraryHandlers`, and `syncHandlers`, and runs a deterministic async teardown sequence (`cleanup()` -> `syncEngine.stop()` -> `testFakeWsController.reset()` -> `vi.clearAllTimers()` / `vi.useRealTimers()` -> macrotask flush -> `server.resetHandlers()` -> store resets) to prevent dangling promises across tests.
- Note on `SnackbarHost` tests: `SnackbarHost` displays one queued snackbar at a time (`autoHideDuration` default 5000ms); if a test triggers an earlier toast (e.g. a live reminder) and then checks a subsequent toast without fake timers, dismiss the active Alert (`Close` button) first.
- Sync engine unit tests (`src/api/sync-engine.test.ts`) instantiate isolated `createSyncEngine({ client, WebSocketCtor })` instances with `autoOpen: false` to test ticket URLs, delta/tombstone ordering, `resyncRequired`, and `live -> polling -> offline -> live` transitions deterministically.

## Theming & UI Rules (`src/theme/`, ESLint)

- **CSS-variables theming**: Always use semantic MUI palette tokens (`text.secondary`, `background.paper`, `action.hover`, `alpha(theme.palette.<semantic>.main, ...)`, etc.) — never hardcode hex/RGB colors.
- **Strings discipline (WD3)**: Keep all user-facing copy in `src/app/strings.ts`, `src/shared/strings.ts`, and `src/pages/<PageName>/strings.ts`.
- **No-Raw-HTML Rule (`react/forbid-elements`)**: Raw HTML/SVG host elements (`<div>`, `<span>`, `<a>`, `<button>`, `<img>`, `<svg>`, etc.) are forbidden in `src/`. Always use MUI components (with `component="..."` where needed, e.g. `<Link component={RouterLink}>` or `<IconButton component="a">`).
