# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W2 — Shell, library core & sync engine**. Builds on W0+W1 with typed bookmarks/collections/sync Zod schemas and endpoints, `useLibraryStore` & `useSyncStore` (Zustand), the real-time `syncEngine` (bootstrap → cursor, one-time ticket WebSocket, seq-ordered delta/tombstone application, exponential-backoff reconnect, `/sync/state` fallback polling, `resyncRequired` full refetch), the complete `AppLayout` shell (`SyncStatusIndicator`, search placeholder for W5, collapsible sidebar with W3 collection-tree slot, account menu + sign out), `LibraryPage` with all four MUI layouts (`list | grid | headlines | moodboard`), `BookmarkDetail` right-hand edit drawer, shared card/chip primitives in `src/shared/`, and a fake-WebSocket + MSW test harness.

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
│  ├─ sync-engine.ts      # Real-time sync engine (bootstrap, WS ticket, deltas, polling fallback, resync)
│  ├─ endpoints/
│  │  ├─ auth.ts          # /api/v1/auth/* endpoint methods
│  │  ├─ bookmarks.ts     # /api/v1/bookmarks* + icon URL helpers
│  │  ├─ collections.ts   # /api/v1/collections* endpoint methods
│  │  └─ sync.ts          # /api/v1/sync/{state,changes,ticket} methods
│  └─ schemas/
│     ├─ problem.ts       # RFC 7807 problem+json schema + ApiError class & guards
│     ├─ auth.ts          # Auth request/response Zod boundary schemas + LoginOutcome
│     ├─ bookmarks.ts     # Bookmark, TagUsage, BookmarkStats & UpdateBookmark Zod schemas
│     ├─ collections.ts   # Collection & CollectionSnapshot Zod schemas
│     └─ sync.ts          # SyncState, SyncTicket, SyncChange, WS frame Zod schemas
├─ stores/
│  ├─ authStore.ts        # Authentication state, in-memory token wiring, sync cleanup on logout/expiry
│  ├─ uiStore.ts          # Snackbar queue & dialog state
│  ├─ syncStore.ts        # Sync connectionState ('live' | 'polling' | 'offline'), cursor, sync flags
│  └─ libraryStore.ts     # Single client cache (WD1): bookmarksById, collectionsById, tagsById, views, selection
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
│  ├─ AppLayout.tsx       # Authenticated shell (AppBar, Search placeholder, SyncStatusIndicator, ThemeSwitcher, Account Menu, collapsible Drawer)
│  ├─ guards.tsx          # RequireAuth, RequireAdmin, PublicOnly route wrappers
│  ├─ redirect.ts         # Safe post-login return-URL resolver
│  ├─ routes.tsx          # Lazy-loaded route table with auth & role guards
│  └─ strings.ts          # Central shell UI strings (WD3)
├─ theme/
│  ├─ theme.ts            # Single ThemeId -> ThemeDefinition registry
│  ├─ palettes/           # light.ts & dark.ts PaletteOptions
│  ├─ typography.ts       # Shared typography tokens
│  ├─ shape.ts            # Shared border radius / shape tokens
│  ├─ components.ts       # Shared MUI component defaultProps & styleOverrides
│  └─ ThemeController.tsx # MUI ThemeProvider (cssVariables: true) + persistence + hook
├─ shared/
│  ├─ components/         # Cross-page MUI components: AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher, SyncStatusIndicator, BookmarkIconBadge, ContentTypeChip, ContentTypeIcon, FavoriteToggleButton, TagChipList
│  ├─ hooks/              # Cross-page reusable hooks
│  └─ actions/            # Cross-page reusable optimistic mutations (bookmarkActions.ts)
├─ test/
│  ├─ setup.ts            # Vitest setup (RTL matchers, MSW server, FakeWebSocket install, store/engine resets)
│  ├─ msw/
│  │  ├─ handlers.ts      # Default auth, library & sync MSW handlers + fixture factories
│  │  └─ server.ts        # msw/node setupServer instance
│  └─ ws/
│     └─ fake-ws.ts       # FakeWebSocket + FakeWebSocketController for deterministic sync testing
└─ pages/
   ├─ LibraryPage/        # 4 layouts (list | grid | headlines | moodboard), sort, scope tabs, load-more paging
   ├─ BookmarkDetail/     # /bookmarks/:bookmarkId right-hand MUI Drawer with optimistic editing, trash/restore
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}`.
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,actions}/`.

## Library Cache, Sync Engine & W3 Handoff Notes

- **Single client cache (`useLibraryStore` — WD1)**:
  - Stores normalized entities (`bookmarksById`, `collectionsById`, `tagsById`, `highlightsByBookmarkId`, `stats`), per-view paginated ID lists (`views[viewKey]`), `layoutMode` (`'list' | 'grid' | 'headlines' | 'moodboard'`), `selectedBookmarkIds` (consumed by W7 bulk actions), and `pendingOptimistic` snapshots for instant rollback on mutation failure.
  - **Do not persist `layoutMode` or view caches to `localStorage` automatically on mount** (W1's `LoginPage` suite asserts `localStorage.length === 0` after login).
- **Optimistic updates & echo reconciliation (`src/shared/actions/bookmarkActions.ts`)**:
  - `toggleBookmarkFavoriteAction`, `updateBookmarkDetailsAction`, `trashBookmarkAction`, and `restoreBookmarkAction` apply immediate optimistic patches via `beginOptimisticBookmark`, commit server responses via `commitOptimisticBookmark`, roll back via `rollbackOptimisticBookmark` + snackbar error on failure, and reconcile with incoming WS sync echoes (`applySyncChanges`).
- **Real-time sync engine (`src/api/sync-engine.ts` & `useSyncStore`)**:
  - `AppLayout` invokes `syncEngine.start()` while authenticated and `syncEngine.stop()` on unmount; `useAuthStore` also calls `syncEngine.stop()` + store resets on `logout()`, `onSessionExpired`, and `reset()`.
  - Bootstrap runs `GET /sync/state` + `GET /bookmarks` + `GET /collections` + `GET /bookmarks/tags` + `GET /bookmarks/stats`, then mints a one-time ticket via `POST /sync/ticket` and connects to `/api/v1/sync/ws?ticket=...`.
  - WS change notifications trigger single-flight coalesced `GET /sync/changes?since=<cursor>` pulls; snapshots and tombstones apply in strict `BigInt(seq)` ascending order regardless of server delivery order.
  - When the socket drops, the engine enters `'polling'` (checking `GET /sync/state` periodically), retries WS with exponential backoff + fresh tickets, transitions to `'offline'` if polling/network fails, and triggers a full refetch whenever `resyncRequired: true`.
- **Handoff for W3 (Collections — tree, drag-and-drop, share)**:
  - `useLibraryStore` already maintains `collectionsById` from bootstrap and `collection` WS/delta events (`CollectionSnapshot` preserves `bookmarkCount`, removes soft-trashed/deleted rows), plus `selectSortedCollections(state)`.
  - Note that `CollectionSnapshotDto` omits `bookmarkCount` on delta events (currently preserving previous `bookmarkCount` or defaulting to `0`); W3 can optionally refresh `/collections` or compute direct counts when membership mutations happen.
  - `AppLayout.tsx` renders a dedicated Collections section in the left `<Drawer>` (`drawerCollectionsHeading`, currently displaying a lightweight read-only preview + W3 hint) where W3 can mount the interactive collection tree, CRUD modals, drag-and-drop, and public share dialog without altering the outer shell layout.
  - `/collections/:collectionId` in `src/pages/CollectionPage/index.tsx` is wired behind `<RequireAuth />` inside `AppLayout` and ready to reuse `BookmarkLayouts` (move/promote reusable layout container into `src/shared/` if shared between `LibraryPage` and `CollectionPage`, preserving the no-cross-page-import rule).

## Testing, MSW & Fake WebSocket Patterns (`src/test/`)

- **MSW v2 (`msw@^2.15.0`) + FakeWebSocket**: `src/test/setup.ts` installs `FakeWebSocket` (`src/test/ws/fake-ws.ts`) on `globalThis.WebSocket` (`autoOpen = true` by default so shell/routing tests reach `'live'` cleanly), registers default `authHandlers`, `libraryHandlers`, and `syncHandlers`, and stops `syncEngine` + resets all stores between tests.
- Sync engine unit tests (`src/api/sync-engine.test.ts`) instantiate isolated `createSyncEngine({ client, WebSocketCtor })` instances with `autoOpen: false` to test ticket URLs, delta/tombstone ordering, `resyncRequired`, and `live -> polling -> offline -> live` transitions deterministically.

## Theming & UI Rules (`src/theme/`, ESLint)

- **CSS-variables theming**: Always use semantic MUI palette tokens (`text.secondary`, `background.paper`, `action.hover`, etc.) — never hardcode hex/RGB colors.
- **Strings discipline (WD3)**: Keep all user-facing copy in `src/app/strings.ts` and `src/pages/<PageName>/strings.ts`.
- **No-Raw-HTML Rule (`react/forbid-elements`)**: Raw HTML/SVG host elements (`<div>`, `<span>`, `<a>`, `<button>`, `<img>`, `<svg>`, etc.) are forbidden in `src/`. Always use MUI components (with `component="..."` where needed, e.g. `<Link component={RouterLink}>` or `<IconButton component="a">`).
