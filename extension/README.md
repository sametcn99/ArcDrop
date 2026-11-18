# ArcDrop Browser Extension

ArcDrop's browser extension (popup + options + background), built with
[Extension.js](https://extension.js.org) — one `manifest.json`, compiled
TypeScript/React entries, `dist/<browser>` output.

Targets: **chromium** (Chrome + Edge) and **Firefox**. Manifest V3.

## Requirements

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

> Firefox temporary add-ons are removed on restart; a signed build (E6) is the
> persistent path.

## Structure

```
extension/
├─ manifest.json      # MV3 manifest; TS/TSX entry paths (Extension.js compiles them)
├─ popup/             # popup entry: connection/auth state machine (E1) + save editor (E2)
├─ options/           # options page entry (placeholder until E5)
├─ background/        # MV3 service worker: auth broker (E1); menus/quick-save in E2/E4
├─ shared/            # vault, auth API core, broker protocol, strings, theme
└─ dist/              # build output (gitignored): chromium/ + firefox/
```

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
bun run test          # unit tests (bun test) — vault, broker, fetch layer, URLs
bun run generate:api  # regenerate shared/api-types.gen.ts from a RUNNING API
bun run smoke:auth    # live auth smoke against a running API (env-documented in the script)
```

`generate:api`/`smoke:auth` need a live ArcDrop API (`docker compose up -d`
at the repo root works); they are never run by CI.

## Notes

- Permissions `storage`, `activeTab`, `contextMenus`, `scripting` are declared
  up front (used from E1+); server access is requested at runtime for **only
  the user's own server origin** via `optional_host_permissions`.
- The `quick-save` command (Ctrl+Shift+S) is declared in the manifest now and
  wired up in E2.
- CI: `.github/workflows/ci-extension.yml` lints, typechecks and builds both
  browsers, uploading `dist/chromium` + `dist/firefox` as artifacts.
