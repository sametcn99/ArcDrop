# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W3 — Collections**. Builds on W0–W2 with the full collection experience: interactive hierarchical `CollectionTreeSidebar` (expand/collapse persistence, context menus, root/child CRUD, MUI icon & color pickers, two-phase delete with 409 blocked-with-children & `cascade=trash` subtree confirmation, `shared=true` listing toggle, WS delta reconciliation), `@dnd-kit/core` + `@dnd-kit/sortable` drag-and-drop (drag-to-nest with 409 cycle surfacing, sibling reorder via `PATCH /collections/order`, bookmark-onto-collection membership via `POST /bookmarks/bulk` union move), `CollectionPage` reusing shared `BookmarkLayouts` scoped by `collectionId` with `sort=manual` drag & accessible arrow reordering (`PATCH /collections/:id/bookmarks/order`), public share dialog (public + RSS URLs, copy, disable rotation warning), and collection merge dialog (source/target validation, 409 descendant conflict, result summary).

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
│  │  ├─ bookmarks.ts     # /api/v1/bookmarks* + collection membership/bulk + icon URL helpers
│  │  ├─ collections.ts   # /api/v1/collections* tree, CRUD, order, manual bookmark order, share, merge
│  │  └─ sync.ts          # /api/v1/sync/{state,changes,ticket} methods
│  └─ schemas/
│     ├─ problem.ts       # RFC 7807 problem+json schema + ApiError class & guards
│     ├─ auth.ts          # Auth request/response Zod boundary schemas + LoginOutcome
│     ├─ bookmarks.ts     # Bookmark, TagUsage, BookmarkStats, Bulk & Membership Zod schemas
│     ├─ collections.ts   # Collection, CollectionNode, Share, Order & Merge Zod schemas
│     └─ sync.ts          # SyncState, SyncTicket, SyncChange, WS frame Zod schemas
├─ stores/
│  ├─ authStore.ts        # Authentication state, in-memory token wiring, sync cleanup on logout/expiry
│  ├─ uiStore.ts          # Snackbar queue & dialog state
│  ├─ syncStore.ts        # Sync connectionState ('live' | 'polling' | 'offline'), cursor, sync flags
│  └─ libraryStore.ts     # Single client cache (WD1): bookmarksById, collectionsById, tree expansion, views, selection
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
│  ├─ AppLayout.tsx       # Authenticated shell + unified dnd-kit DndContext/DragOverlay + CollectionTreeSidebar slot
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
│  ├─ strings.ts          # Central shared bookmark & collection UI copy (WD3)
│  ├─ components/         # Cross-page MUI components: AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher, SyncStatusIndicator, BookmarkIconBadge, BookmarkLayouts (draggable & sortable), ContentTypeChip, ContentTypeIcon, FavoriteToggleButton, TagChipList, CollectionIcon, CollectionTreeSidebar, CollectionFormDialog, CollectionDeleteDialog, CollectionShareDialog, CollectionMergeDialog
│  ├─ hooks/              # Cross-page hooks (`useAppDnd.ts` DndContext coordination & drag/drop ID helpers)
│  ├─ utils/              # Cross-page pure helpers (`collectionTree.ts`)
│  └─ actions/            # Cross-page optimistic mutations (`bookmarkActions.ts`, `collectionActions.ts`)
├─ test/
│  ├─ setup.ts            # Vitest setup (RTL matchers, MSW server, FakeWebSocket install, store/engine resets)
│  ├─ msw/
│  │  ├─ handlers.ts      # Default auth, library, collection & sync MSW handlers + fixture factories
│  │  └─ server.ts        # msw/node setupServer instance
│  └─ ws/
│     └─ fake-ws.ts       # FakeWebSocket + FakeWebSocketController for deterministic sync testing
└─ pages/
   ├─ LibraryPage/        # 4 layouts (shared BookmarkLayouts), sort, scope tabs, load-more paging
   ├─ CollectionPage/     # /collections/:collectionId scoped library, breadcrumbs, sort=manual drag/arrow reorder
   ├─ BookmarkDetail/     # /bookmarks/:bookmarkId right-hand MUI Drawer with optimistic editing, trash/restore
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}`.
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,utils,actions}/`.

## Library Cache, Sync Engine, Collections & W4 Handoff Notes

- **Single client cache (`useLibraryStore` — WD1)**:
  - Stores normalized entities (`bookmarksById`, `collectionsById`, `tagsById`, `highlightsByBookmarkId`, `stats`), per-view paginated ID lists (`views[viewKey]`, supporting both `library:...` and `collection:<id>|<sort>` keys), `layoutMode` (`'list' | 'grid' | 'headlines' | 'moodboard'`), `expandedCollectionIds` (`arcdrop.collectionTree.expanded`), `selectedBookmarkIds` (consumed by W7 bulk actions), and `pendingOptimistic` snapshots for instant rollback on mutation failure.
  - **Do not write to `localStorage` automatically on initial mount** (W1's `LoginPage` suite asserts `localStorage.length === 0` after login). `syncExpandedFromStorage()` only reads `localStorage.getItem`; `localStorage.setItem` runs strictly on explicit user expand/collapse or collection nesting interactions.
- **Unified Drag-and-Drop (`AppLayout` + `useAppDnd` + `BookmarkLayouts` + `CollectionTreeSidebar` — WD4)**:
  - `AppLayout` hosts a single `<DndContext>` + `<DragOverlay>` coordinating drags across `BookmarkLayouts` and `CollectionTreeSidebar` (bookmark-onto-collection membership via `POST /bookmarks/bulk` `action: 'move', mode: 'union'`, collection drag-to-nest via `PUT /collections/:id` with 409 cycle error surfacing, collection sibling reorder via `PATCH /collections/order`, and `CollectionPage` `sort=manual` `SortableContext` reorder via `PATCH /collections/:id/bookmarks/order`).
  - Note: `AppLayout` renders the mobile drawer with `enableDnd={false}` and desktop drawer with `enableDnd={true}` to prevent duplicate `@dnd-kit` droppable/draggable IDs across MUI's mounted drawers.
  - `CollectionPage` also wraps `BookmarkLayouts` in a fallback `<DndContext>` when rendered outside `AppLayout` (`!hasProvider`).
- **Collection count reconciliation (`CollectionSnapshot` caveat)**:
  - Because `CollectionSnapshotDto` in sync events omits `bookmarkCount`, `collectionActions.ts` reconciles multi-row mutations (cascade delete, merge, bookmark-to-collection membership add/replace) via `refreshCollectionsTreeAction()` (`GET /collections/tree`) alongside bookmark `stats` refresh.
- **Handoff for W4 (Item richness — tags, highlights, notes, reminders)**:
  - `useLibraryStore` already allocates `highlightsByBookmarkId` and `tagsById` (`hydrateTags`, `tagsById`), and `BookmarkLayouts` (`src/shared/components/BookmarkLayouts.tsx`) is now promoted to `src/shared/` so any enrichment badges/chips added to shared cards automatically appear in both `LibraryPage` and `CollectionPage`.
  - `bookmarksApi.replaceCollections` (`PUT /bookmarks/:id/collections`) and `replaceBookmarkCollectionsAction` are already implemented in `src/api/endpoints/bookmarks.ts` & `src/shared/actions/collectionActions.ts` if `BookmarkDetail` exposes a collection assignment picker alongside tag/highlight/reminder editors.

## Testing, MSW & Fake WebSocket Patterns (`src/test/`)

- **MSW v2 (`msw@^2.15.0`) + FakeWebSocket**: `src/test/setup.ts` installs `FakeWebSocket` (`src/test/ws/fake-ws.ts`) on `globalThis.WebSocket` (`autoOpen = true` by default so shell/routing tests reach `'live'` cleanly), registers default `authHandlers`, `libraryHandlers`, and `syncHandlers`, and stops `syncEngine` + resets all stores between tests.
- Sync engine unit tests (`src/api/sync-engine.test.ts`) instantiate isolated `createSyncEngine({ client, WebSocketCtor })` instances with `autoOpen: false` to test ticket URLs, delta/tombstone ordering, `resyncRequired`, and `live -> polling -> offline -> live` transitions deterministically.

## Theming & UI Rules (`src/theme/`, ESLint)

- **CSS-variables theming**: Always use semantic MUI palette tokens (`text.secondary`, `background.paper`, `action.hover`, etc.) — never hardcode hex/RGB colors.
- **Strings discipline (WD3)**: Keep all user-facing copy in `src/app/strings.ts`, `src/shared/strings.ts`, and `src/pages/<PageName>/strings.ts`.
- **No-Raw-HTML Rule (`react/forbid-elements`)**: Raw HTML/SVG host elements (`<div>`, `<span>`, `<a>`, `<button>`, `<img>`, `<svg>`, etc.) are forbidden in `src/`. Always use MUI components (with `component="..."` where needed, e.g. `<Link component={RouterLink}>` or `<IconButton component="a">`).
