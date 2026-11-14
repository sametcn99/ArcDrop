# ArcDrop Web (`@arcdrop/web`)

Client-side React + MUI SPA for ArcDrop, located in `apps/web/app` as a Bun workspace package.

**Status:** **W0 — Scaffold & theming**. Includes Vite + React + strict TypeScript, the extensible MUI CSS-variables theme system, ESLint `react/forbid-elements` enforcement, lazy-loaded router shell across all planned routes, empty `AppLayout` skeleton, Vitest + Testing Library setup, and CI web job.

## Scripts

Run from `apps/web/app` (or via `bun --cwd=apps/web/app run <script>` / `bun run web:<script>` from the repo root):

| Script              | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `bun run dev`       | Start the Vite dev server (`http://localhost:5173`)         |
| `bun run build`     | Build production assets + route-level lazy chunks (`dist/`) |
| `bun run preview`   | Preview the production build locally                        |
| `bun run lint`      | Run ESLint (repo-root flat config + no-raw-HTML rule)       |
| `bun run typecheck` | Strict TypeScript check (`tsc --noEmit`)                    |
| `bun run test`      | Run Vitest + Testing Library unit/component suite once      |

## Architecture & Folder Contract

The codebase enforces strict page-colocation boundaries:

```text
apps/web/app/src/
├─ main.tsx               # React root mount
├─ app/
│  ├─ AppProviders.tsx    # Top-level provider composition (ThemeController -> RouterProvider)
│  ├─ AppLayout.tsx       # Authenticated shell skeleton (AppBar + Drawer + Outlet)
│  ├─ routes.tsx          # Lazy-loaded route table for every planned page
│  └─ strings.ts          # Central shell UI strings (WD3)
├─ theme/
│  ├─ theme.ts            # Single ThemeId -> ThemeDefinition registry
│  ├─ palettes/
│  │  ├─ light.ts         # Light PaletteOptions
│  │  └─ dark.ts          # Dark PaletteOptions
│  ├─ typography.ts       # Shared typography tokens
│  ├─ shape.ts            # Shared border radius / shape tokens
│  ├─ components.ts       # Shared MUI component defaultProps & styleOverrides
│  └─ ThemeController.tsx # MUI ThemeProvider (cssVariables: true) + persistence + hook
├─ shared/
│  ├─ components/         # Cross-page reusable MUI components (e.g. PlaceholderPage, ThemeSwitcher)
│  ├─ hooks/              # Cross-page reusable hooks
│  └─ actions/            # Cross-page reusable API mutation wrappers (W1+)
└─ pages/
   └─ <PageName>/         # Page-private folder: index.tsx, strings.ts, components/, hooks/, actions/
```

**Colocation rules:**

1. Each page owns `src/pages/<PageName>/{index.tsx,strings.ts,components/,hooks/,actions/}`.
2. Page-local files are **strictly private** to that page — another page must never import from `../OtherPage/...`.
3. Anything reused by two or more pages belongs in `src/shared/{components,hooks,actions}/`.

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

Raw HTML and inline SVG host elements (`<div>`, `<span>`, `<p>`, `<button>`, `<input>`, `<a>`, `<svg>`, etc.) are **forbidden anywhere in `src/`**.

- Enforced by ESLint `react/forbid-elements` in the repo-root `eslint.config.mjs`.
- Violations fail `bun run lint` and CI.
- Always use MUI components (with the `component` prop when semantic HTML tags are needed, e.g. `<Box component="main">` or `<Typography component="h1">`).

### Host-Element → MUI Equivalents

| Raw HTML element                                                                        | MUI equivalent                                                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `<div>`, `<section>`, `<main>`, `<header>`, `<footer>`, `<nav>`, `<aside>`, `<article>` | `<Box>` (with `component="main"`, `component="nav"`, etc.) or `<Stack>` / `<Container>` |
| `<span>`, `<p>`                                                                         | `<Typography variant="body1" \| "body2" \| "caption">` or `<Box component="span">`      |
| `<h1>` – `<h6>`                                                                         | `<Typography variant="h1" ... "h6" component="h1">`                                     |
| `<a>`                                                                                   | `<Link>` (or `<Button component={RouterLink} to="...">`)                                |
| `<button>`                                                                              | `<Button>`, `<IconButton>`, or `<Fab>`                                                  |
| `<input>`, `<textarea>`                                                                 | `<TextField>` or `<OutlinedInput>`                                                      |
| `<select>`, `<option>`                                                                  | `<Select>` + `<MenuItem>` or `<Autocomplete>`                                           |
| `<label>`                                                                               | `<InputLabel>` or `<FormControlLabel>`                                                  |
| `<form>`                                                                                | `<Box component="form" onSubmit={...}>`                                                 |
| `<ul>`, `<ol>`, `<li>`                                                                  | `<List>`, `<ListItem>`, `<ListItemButton>`, `<ListItemText>`                            |
| `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`                                 | `<Table>`, `<TableHead>`, `<TableBody>`, `<TableRow>`, `<TableCell>`                    |
| `<img>`                                                                                 | `<Box component="img" src={...} alt={...} />` or `<Avatar>`                             |
| `<hr>`                                                                                  | `<Divider />`                                                                           |
| `<dialog>`                                                                              | `<Dialog>`, `<DialogTitle>`, `<DialogContent>`, `<DialogActions>`                       |
| `<code>`, `<pre>`                                                                       | `<Typography component="code" sx={{ fontFamily: 'monospace' }}>`                        |
| `<svg>`, `<path>`, …                                                                    | `@mui/icons-material/*` or `<SvgIcon>`                                                  |
| `<iframe>` (sandboxed reader)                                                           | `<Box component="iframe" ... />`                                                        |
