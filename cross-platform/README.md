# ArcDrop — Cross-Platform Shell (Tauri v2)

The Tauri v2 project that wraps the universal web client (`apps/web/app`) into
native desktop (Windows/macOS/Linux) and mobile (Android/iOS) apps. The UI
codebase is never copied — the build embeds `apps/web/app/dist` and dev mode
talks to the Vite dev server for live reload.

Managed by plan T1 (skeleton + CI). Server address is entered at runtime
inside the app (Vaultwarden-style), so a single build works against any
ArcDrop server.

## Prerequisites

| Platform         | Requirements                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All              | [Rust](https://rustup.rs) (version pinned in `src-tauri/rust-toolchain.toml`), [Bun](https://bun.sh)                                                                                       |
| Windows          | Microsoft C++ Build Tools (MSVC x86/x64) + Windows 10/11 SDK; WebView2 runtime (preinstalled on Win 11)                                                                                    |
| Linux            | `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` (see [Tauri prerequisites](https://tauri.app/start/prerequisites/)) |
| Android          | Android Studio (or cmdline-tools): SDK platform 24+, NDK (side-by-side), `JAVA_HOME` set, `ANDROID_HOME` + `NDK_HOME` env vars                                                             |
| iOS (macOS only) | Xcode + [xcodegen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)                                                                                                        |

Rust Android targets (installed automatically by `android:init`):

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## Setup

From the repo root (installs `apps/web/app` workspace deps):

```sh
bun install
```

Then inside `cross-platform/` (standalone setup, own lockfile):

```sh
bun install
```

## Commands

| Command                                          | What it does                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev`                                    | Desktop dev — opens the app against the Vite dev server (live reload; run the API from the repo root if needed)                                      |
| `bun run build`                                  | Desktop build with platform bundles (installers; signing is T6)                                                                                      |
| `bun run build:no-bundle`                        | Desktop compile without installers (what CI desktop jobs run)                                                                                        |
| `bun run android:init`                           | Generate `src-tauri/gen/android` (committed to git)                                                                                                  |
| `bun run android:dev`                            | Android dev on a connected device/emulator                                                                                                           |
| `bun run android:build`                          | Debug APK → `src-tauri/gen/android/app/build/outputs/apk/`                                                                                           |
| `bun run ios:init` / `ios:build`                 | iOS Xcode project / simulator build (**macOS only** — the Tauri CLI ships the `ios` subcommand in its macOS build; CI generates `gen/apple` per run) |
| `bun run icon`                                   | Regenerate `src-tauri/icons/` from `apps/web/app/public/favicon.svg`                                                                                 |
| `bun run rust:fmt` / `rust:clippy` / `rust:test` | Rust quality gates (CI enforces `-D warnings`)                                                                                                       |

> **Windows + Bun note:** bun's script-runner environment currently trips a
> Tauri CLI bug when launching _mobile_ commands (`npm_execpath` handling —
> tauri-cli `mobile/init.rs` unwrap panic). The `android:*`/`ios:*` scripts
> therefore invoke the CLI's JS entry directly
> (`bun node_modules/@tauri-apps/cli/tauri.js …`); use the same form if you
> call other mobile commands manually.

## Layout

```text
cross-platform/
├─ src-tauri/
│  ├─ Cargo.toml / rust-toolchain.toml
│  ├─ tauri.conf.json          # frontendDist → ../../apps/web/app/dist
│  ├─ capabilities/            # window permissions (T1: core:default only)
│  ├─ icons/                   # generated by `bun run icon`
│  └─ gen/android/             # generated by `bun run android:init` (committed)
└─ package.json                # scripts + @tauri-apps/cli, own lockfile
```

## Notes

- **Identifier**: `com.arcdrop.client` (plan T2 decision — must not end in
  `.app`, which clashes with the macOS bundle extension). Changing it means
  re-running `android:init` and re-applying the portable `BuildTask.kt`.
- **Android back button**: Tauri's built-in `AppPlugin` handles the hardware
  back button — web history back when possible, otherwise the app closes.
  Registering a JS listener would disable that default, so the platform
  adapter's `onBackButton` intentionally stays a no-op.
- **Status bar / safe areas** (plan T2): Android runs edge-to-edge
  (`enableEdgeToEdge()` in the generated `MainActivity`), so the themed app
  surface extends behind the transparent status bar; the web side applies
  `env(safe-area-inset-*)` via the `platform-native` body class
  (`viewport-fit=cover` is set in `apps/web/app/index.html`).
- `tauri.conf.json` sets `app.withGlobalTauri: true` so the web client can
  invoke shell commands through `window.__TAURI__` without adding the
  `@tauri-apps/api` package to `apps/web/app` (T1). T2 adds the official
  plugin JS packages (`plugin-http`, `plugin-opener`, `plugin-os`) to
  `apps/web/app` — see `apps/web/app/src/platform/tauri.ts`.
- CI: `.github/workflows/ci-cross-platform.yml` — rust-checks, Android debug
  APK, desktop matrix (windows/ubuntu/macos, `--no-bundle`), and an iOS
  simulator build (continuous since T2, unsigned). Full bundles/signing come
  in T6.
