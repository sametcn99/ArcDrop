# ArcDrop

ArcDrop is a self-hosted, multi-user bookmark library. Save links and files, organize them in collections, search archived text, and share collections or RSS feeds from your own server.

## Run ArcDrop

1. Copy `.env.example` to `.env`. Generate independent values for `ARCDROP__JWT__SECRET` and `ARCDROP__TOTP__ENCRYPTION_KEY` with `openssl rand -hex 32`. Set a PostgreSQL password for a new installation.
2. Run `docker compose up --build --wait`.
3. Open [http://127.0.0.1:3000/bootstrap](http://127.0.0.1:3000/bootstrap), create the administrator account, and use **Quick add** to save your first bookmark.

The web service serves the app and proxies the API and WebSocket at the same address. It binds to loopback by default. For network deployment, configure HTTPS at an upstream proxy and set `ARCDROP__PUBLIC__BASE_URL` to the public origin. The [operations guide](apps/api/docs/backup-restore.md) covers trusted proxies, upgrades, backups, restores and TOTP key rotation.

Download desktop installers, mobile packages, browser extensions and prebuilt self-hosted server bundles from the [latest GitHub Release](https://github.com/sametcn99/ArcDrop/releases/latest). Configure the extension and desktop or mobile clients with the same server address used on the web. See the [release guide](cross-platform/RELEASE.md) for installation by platform.

## Repository layout

| Path             | Component                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `apps/api`       | NestJS API on Bun and PostgreSQL, including MCP, archive and sync |
| `apps/web`       | React web app and Caddy deployment                                |
| `extension`      | Chromium and Firefox extension with an embedded web app           |
| `cross-platform` | Tauri desktop and mobile clients                                  |

## Develop and verify

Use Bun 1.4.2, the version pinned in CI and the container images. Run `bun install --frozen-lockfile` at the root. The [API README](apps/api/README.md) describes the local database and API environment.

Run `bun run dev` for the API and `bun run web:dev` for the web app. For the Vite dev server, set `VITE_API_URL=http://localhost:3000` and allow `http://localhost:5173` in API CORS configuration. A split web deployment can set `VITE_PUBLIC_WEB_URL` to the site that serves public collection pages.

| Command                                       | What it checks                                       |
| --------------------------------------------- | ---------------------------------------------------- |
| `bun run lint` / `bun run format:check`       | Source and format rules                              |
| `bun run typecheck` / `bun run web:typecheck` | API and web TypeScript                               |
| `bun run test:unit` / `bun run web:test`      | API and web unit/component tests                     |
| `bun run test:e2e`                            | API integration with disposable PostgreSQL           |
| `bun run build` / `bun run web:build`         | Production builds                                    |
| `bun dev-scripts/smoke-web.ts`                | Real Chromium against a fresh local Compose instance |

The extension and Tauri use their own lockfiles. See the [extension guide](extension/README.md) and [platform release guide](cross-platform/RELEASE.md) for test and package commands.

## Screenshot gallery

Run [Screenshot gallery](https://github.com/sametcn99/ArcDrop/actions/workflows/screenshots.yml) manually from the Actions tab, or run `gh workflow run screenshots.yml --ref main`. The workflow uses a local mock ArcDrop server to capture every app route, the settings and admin tabs, and the extension popup and options. It runs desktop and mobile web layouts, Chromium and Firefox extensions, native desktop apps on Linux, macOS and Windows, and the Android and iOS clients in an emulator and simulator. It also captures the live API reference with a disposable database.

The [gallery snapshot on main](docs/screenshots/latest) contains 229 screenshots from the first complete run. Each complete run on the default branch updates the [generated gallery](https://github.com/sametcn99/ArcDrop/tree/screenshots/docs/screenshots/latest) and attaches the PNGs as workflow artifacts.

## License

ArcDrop is distributed under the [MIT License](LICENSE). The bundled Onest typeface has its own [SIL Open Font License](apps/web/app/public/licenses/Onest.txt).
