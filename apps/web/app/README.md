# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W1 — API client & auth**. Builds on W0's scaffold & theme system with generated OpenAPI TypeScript definitions, Zod boundary schemas, a resilient in-memory-token API client with single-flight refresh rotation, `authStore` & `uiStore` (Zustand), `SnackbarHost`, `RequireAuth` / `RequireAdmin` / `PublicOnly` route guards, full `LoginPage` (including 2FA TOTP & recovery-code step), `BootstrapPage`, `ClaimPage`, AppBar sign-out action, and MSW v2-backed unit/component tests.

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
│  ├─ endpoints/
│  │  └─ auth.ts          # Typed /api/v1/auth/* endpoint methods
│  └─ schemas/
│     ├─ problem.ts       # RFC 7807 problem+json schema + ApiError class & guards
│     └─ auth.ts          # Auth request/response Zod boundary schemas + LoginOutcome
├─ stores/
│  ├─ authStore.ts        # Authentication state, in-memory token wiring, login/bootstrap/claim/logout actions
│  └─ uiStore.ts          # Snackbar queue & dialog state
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider -> SnackbarHost)
│  ├─ AppLayout.tsx       # Authenticated shell (AppBar with user identity & Sign out + Drawer + Outlet)
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
│  ├─ components/         # Cross-page reusable MUI components (AuthPageShell, PlaceholderPage, SnackbarHost, ThemeSwitcher)
│  ├─ hooks/              # Cross-page reusable hooks
│  └─ actions/            # Cross-page reusable API mutation wrappers
├─ test/
│  ├─ setup.ts            # Vitest setup (RTL matchers, MSW server lifecycle, store resets)
│  └─ msw/
│     ├─ handlers.ts      # Default MSW handlers + makeMockUser/makeMockSession/problemJsonResponse factories
│     └─ server.ts        # msw/node setupServer instance
└─ pages/
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}`.
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,actions}/`.

## API Client & Auth Contracts (`src/api/` & `src/stores/`)

- **Base URL**: Configured via `VITE_API_URL` (or `VITE_API_BASE_URL`), defaulting to `window.location.origin` + `/api/v1/*` when served from the same origin.
- **Strictly in-memory tokens**: `apiClient` holds `{ accessToken, refreshToken }` solely in closure memory. Neither token is ever written to `localStorage` or `sessionStorage`.
- **Single-flight refresh & rotation**: Concurrent `401` responses share a single `POST /api/v1/auth/refresh` promise using the current `refreshToken`, store the rotated `{ accessToken, refreshToken }` pair, notify `authStore`, and replay each caller once. If refresh fails (e.g., expired or reuse-detected revocation), tokens are cleared and `onSessionExpired` fires.
- **`problem+json` errors**: Non-OK HTTP responses are parsed into [`ApiError`](src/api/schemas/problem.ts) carrying `status`, `code`, `detail`, `requestId` (body or `x-request-id` header), and raw `extensions`.
- **`TOTP_REQUIRED` outcome**: `authApi.login()` catches `401` responses with `code === 'TOTP_REQUIRED'` and returns `{ kind: 'totp_required', challenge, expiresAt }` instead of throwing; `LoginPage` transitions to its second step (`POST /api/v1/auth/login/tfa`) supporting both 6-digit TOTP codes and recovery codes.
- **Stores (`src/stores/`)**:
  - `useAuthStore`: holds `{ status, user, tfaChallenge, error }` and exposes `login`, `completeTotp`, `cancelTotp`, `bootstrap`, `claim`, `logout`, `refreshMe`, `setSession`, `clearError`, `reset`. Automatically wires `apiClient.setHooks({ onSessionRefreshed, onSessionExpired })`.
  - `useUiStore`: manages the snackbar queue (`enqueueSnackbar`, `dismissSnackbar`, `clearSnackbars`) rendered globally by `<SnackbarHost />` and lightweight dialog state (`activeDialog`, `openDialog`, `closeDialog`).

## Route Guards (`src/app/guards.tsx`)

- `<RequireAuth />` wraps `/` and all authenticated routes, redirecting unauthenticated users to `/login` with `location.state.from` preserved so login navigates back.
- `<RequireAdmin />` wraps `/admin`, enforcing `user.role === 'admin'` (non-admins redirect to `/`).
- `<PublicOnly />` wraps `/login`, `/bootstrap`, and `/claim`, redirecting already-authenticated users to `resolveRedirectTarget(location.state, '/')`.
- `/s/:token` (shared collections) remains intentionally public outside auth guards.

## Testing & MSW Patterns (`src/test/`)

- **MSW v2 (`msw@^2.15.0`)**: Tests run under Bun + Vitest + JSDOM. `msw@^2.15.0` is intentionally pinned because `msw@3.x` moved Node `fetch` interception onto `NodeHttpRequestSource` (`tls.TLSSocket.prototype._wrapHandle` + Undici), which is unsupported under Bun's native `fetch` runtime.
- `src/test/setup.ts` starts `server.listen({ onUnhandledRequest: 'error' })` before all tests and resets handlers, stores (`useAuthStore`, `useUiStore`), storage, and fake timers after each test.
- Add domain handlers alongside `authHandlers` in `src/test/msw/` and reuse `makeMockUser`, `makeMockSession`, and `problemJsonResponse` to construct consistent test responses. Override per-test scenarios via `server.use(...)`.

## Theming Guide (`src/theme/`)

The entire application is themed through MUI's CSS-variables mode (`cssVariables: true`).

- **`src/theme/theme.ts`** is the single theme registry (`THEMES: Record<string, ThemeDefinition>`).
- **`src/theme/ThemeController.tsx`** wraps the app in MUI's `ThemeProvider` (`cssVariables: true`) and `<CssBaseline enableColorScheme />`:
  - Reads the initial choice from `localStorage` (`arcdrop.theme`), falling back to `window.matchMedia('(prefers-color-scheme: dark)')`.
  - Persists explicit theme selections to `localStorage` and tracks OS preference changes when no explicit choice is stored.
  - Exposes `useThemeController()` returning `{ themeId, setTheme, themes }` where `themes` derives directly from the registry (`listThemes()`).
  - Syncs `document.documentElement.dataset.theme` and `colorScheme`, updating CSS custom properties (`--mui-palette-*`) without forcing unrelated subtree re-renders.

### Adding a new theme

Adding a new built-in theme takes **two edits**:

1. Create a palette file in `src/theme/palettes/<name>.ts` exporting a `PaletteOptions` object.
2. Add one line to `THEMES` in `src/theme/theme.ts`:
   ```ts
   <name>: {
     label: '<Display Name>',
     create: () => createAppTheme(<name>Palette),
   },
   ```
   The new theme automatically appears in `useThemeController().themes` and `ThemeSwitcher`. For dynamic runtime/test registration, `registerTheme(id, definition)` returns an unregister cleanup callback.

### Color & styling discipline

- Never hardcode hex/RGB colors inside components or pages. Always use theme palette tokens (`sx={{ color: 'text.secondary', bgcolor: 'background.paper' }}` or `theme.vars.palette.*`).
- Any new semantic color enters through `src/theme/palettes/` and `src/theme/components.ts`.

## Strings Discipline (WD3)

- UI copy is English and **i18n-ready** from day one.
- Every page keeps its user-facing copy in `src/pages/<PageName>/strings.ts` (`as const`), and shell copy lives in `src/app/strings.ts`.
- Avoid scattering inline UI strings across JSX components so future localization or copy audits stay trivial.

## No-Raw-HTML Rule (`react/forbid-elements`)

Raw HTML and inline SVG host elements (`<div>`, `<span>`, `<p>`, `<button>`, `<a>`, `<svg>`, etc.) are **forbidden anywhere in `src/`**.

- Enforced by ESLint `react/forbid-elements` in the repo-root `eslint.config.mjs`.
- Violations fail `bun run lint` and CI.
- Always use MUI components (with the `component` prop when semantic HTML tags are needed, e.g. `<Box component="main">` or `<Typography component="h1">`).
