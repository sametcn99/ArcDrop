# ArcDrop Browser Extension

ArcDrop's browser extension (popup + options + background), built with
[Extension.js](https://extension.js.org) — one `manifest.json`, compiled
TypeScript/React entries, `dist/<browser>` output.

Targets: **chromium** (Chrome + Edge) and **Firefox**. Manifest V3.

> Installing from a release zip? Skip straight to
> [Release & installation](#release--installation) — you only need a running
> ArcDrop server. Everything below the first section is for building from
> source.

## Development requirements

- [Bun](https://bun.sh) 1.2+ (Extension.js runs on Bun; no Node/npm needed)

## Commands

Run these from `extension/` (or via the root wrappers, e.g. `bun run extension:build`):

```bash
bun install          # install dependencies (self-contained lockfile)
bun run dev          # dev server with hot reload (launches a browser)
bun run build        # production build → dist/chromium + dist/firefox
bun run lint         # eslint (repo-compatible rules, MUI-only UI)
bun run typecheck    # tsc --noEmit
bun run format       # prettier (root .prettierrc applies)
```

The extension is intentionally **outside the root Bun workspace** and keeps its
own `bun.lock`, so the root install never touches extension dependencies.

## Loading the build

### Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `extension/dist/chromium`.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/dist/firefox/manifest.json`.

> Firefox temporary add-ons are removed on restart — a signed store build
> (AMO submission, future work) is the persistent installation path.

## Structure

```
extension/
├─ manifest.json      # MV3 manifest; TS/TSX entry paths (Extension.js compiles them)
├─ popup/             # popup entry: save editor (E2) + connection/auth state machine (E1)
├─ options/           # full options page (E5): connection, quick-save, behavior, appearance
├─ background/        # MV3 service worker: auth broker (E1), library broker (E2/E4)
├─ embed-src/         # storage-bridge bootstrap for the embedded app page (E3, committed source)
├─ embed/             # assembled embedded app (gitignored; web dist + bridge, made by prebuild)
├─ scripts/           # codegen (api types/theme/icons) + embed & release helpers
├─ ../dev-scripts/    # live smoke scripts (outside the project so builds never bundle them)
└─ dist/              # build output (gitignored): chromium/ + firefox/ (+ embedded pages/app)
```

## Embedded app page (E3)

`bun run build` embeds the REAL ArcDrop web app at `pages/app/` inside the
extension:

- **Build**: prebuild runs the web app build with `ARCDROP_EMBED=extension`
  (relative asset base) + `VITE_ROUTER_MODE=hash` (extension pages cannot
  serve history-mode paths), assembles `embed/`, then the postbuild step
  copies it verbatim into every `dist/<browser>/pages/app/`. The regular web
  build/CI is unaffected — both switches are env-conditional.
- **Storage bridge** (`embed-src/bootstrap.js`, served at `pages/app/bootstrap.js`):
  runs before the app bundle, hydrates `localStorage` (`arcdrop.baseUrl`,
  `arcdrop.refreshToken`) from the vault, mirrors vault changes into it,
  forwards app-side writes back into the vault (onboarding address, app-side
  login → `auth/ingest-session`), and patches `fetch` so API calls carry a
  broker-issued access token while the client's own `POST /auth/refresh` is
  answered from broker state. **The background broker remains the only
  rotation owner** — one session across popup, app page and worker.
- **Open in ArcDrop** (popup) opens `pages/app/index.html`; unsaved pages
  arrive via the `#/quick-add?url=…` deep link.

## Connection & auth (E1)

- **Vaultwarden-style setup**: popup → server address (https default) →
  runtime host permission for **that origin only** → ArcDrop identity check
  (`/openapi.json`) → email/password sign-in (+TOTP challenge when 2FA is on)
  → connected.
- **Vault**: `chrome.storage.local` (schema v1) holds `baseUrl`, tokens and
  the user id/email. The **background auth broker** is the single writer; the
  popup talks to it via `chrome.runtime.sendMessage` (`shared/messages.ts`).
- **Token refresh is single-flight in the background**: a cached access JWT
  is used until 30 s before its `exp` claim, then `POST /auth/refresh` runs
  once (rotating the refresh token); a rejected refresh clears the session
  and the popup returns to sign-in.
- Disconnect revokes the refresh token server-side, clears tokens/user and
  keeps the server address for fast reconnection.

## Developer utilities

```bash
bun run test             # unit tests (bun test) — vault, brokers, fetch layer, URLs
bun run generate:api     # regenerate shared/api-types.gen.ts from a RUNNING API
bun run generate:theme   # regenerate shared/theme-palettes.gen.ts (web palette sync)
bun run smoke:auth       # live auth smoke against a running API (env-documented in the script)
bun run smoke:bookmarks  # live E2 bookmark flow smoke (create/find/update/tags/trash)
bun run smoke:totp       # live 2FA login flow smoke (creates a disposable user; needs an admin)
bun run smoke:bridge     # live E3 storage-bridge contract smoke
bun run smoke:e4         # live E4 flow smoke (image upload, selection append, bulk)
```

`generate:api` lives in `extension/scripts/`; the live smoke scripts live in
`<repo>/dev-scripts/` (outside the extension project so the build never
bundles them). All of them need a live ArcDrop API (`docker compose up -d`
at the repo root works); none are run by CI.

## Release & installation

Prerequisite: a running ArcDrop server you control (see the main repository
README) — the extension connects to it during setup.

**From a release zip** (recommended):

1. Download `arcdrop-extension-chromium.zip` (or `-firefox.zip`) from the
   GitHub Releases page and unzip it.
2. Chrome/Edge: `chrome://extensions` → Developer mode → **Load unpacked** →
   select the unzipped folder. Firefox: `about:debugging` → **Load Temporary
   Add-on…** → the unzipped `manifest.json`.
3. Open the popup, enter your server address, sign in — done.

**From source**: `bun install && bun run build` inside `extension/`, then
load `dist/chromium` unpacked as above. `bun run build:release` produces the
store-ready zips (`dist/arcdrop-extension-*.zip`, verified by
`bun run verify:release`).

## Privacy

The extension exchanges data exclusively with the ArcDrop server you
configure during setup — **no analytics, no telemetry, no third-party
requests**. Session tokens and preferences live in `chrome.storage.local`
in your browser profile. Page content is only read when you invoke a save
(action/shortcut/context menu), and image saves request one-time access to
the image's origin. Full listing notes live in [`STORE.md`](STORE.md).

## Permissions

| Permission                  | Why                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `storage`                   | Local server address, session and preference storage.                                              |
| `activeTab`                 | Reads the active page's URL/title only when you invoke the extension.                              |
| `contextMenus`              | Right-click "Save to ArcDrop" entries.                                                             |
| `scripting`                 | Injects the metadata collector on explicit save actions (activeTab-gated).                         |
| `optional_host_permissions` | Runtime access **only** to your server origin (setup) and, one-time, an image origin (image save). |

## Future work

- `chrome.storage.sync` for preferences across devices.
- Server-side cover assignment + an extension cover picker (needs an API
  surface decision — see the plan's E7 backlog note).
- Site-internal highlight overlay (Raindrop's in-page marking).
- Safari target; signed Firefox build; Chrome Web Store / AMO submission.

## Notes

- Permissions `storage`, `activeTab`, `contextMenus`, `scripting` are declared
  up front (used from E1+); server access is requested at runtime for **only
  the user's own server origin** via `optional_host_permissions`.
- The `quick-save` command (Ctrl+Shift+S) is declared in the manifest now and
  wired up in E2.
- CI: `.github/workflows/ci-extension.yml` lints, typechecks and builds both
  browsers, uploading `dist/chromium` + `dist/firefox` as artifacts.
