# ArcDrop — Release Guide (cross-platform shell)

Everything needed to cut a release: version bump, tagging, the CI pipeline,
signing keys (desktop updater + Android keystore) and the v0.1.0 draft notes.
The GitHub workflow `.github/workflows/release-cross-platform.yml` runs on
tag pushes `v*` and assembles a DRAFT release — publishing is a deliberate,
manual step.

## 1. Version bump (single source)

```sh
cd cross-platform
bun run bump -- 0.2.0        # writes package.json + tauri.conf.json + Cargo.toml
cd src-tauri && cargo update -p arcdrop   # refresh Cargo.lock
```

Commit the bump (`chore(cross-platform): release v0.2.0`).

## 2. Tag & push

```sh
git tag v0.2.0
git push origin main v0.2.0   # push is gated on the release orchestrator
```

## 3. What CI does (`release-cross-platform.yml`)

| Job        | Runner                   | Output                                                                                                                                              |
| ---------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| desktop ×3 | windows / ubuntu / macos | MSI + NSIS (win), DMG (mac), AppImage + deb (linux) via `tauri-action` → uploaded to a DRAFT release; updater artifacts + `latest.json` when signed |
| android    | ubuntu                   | release AAB + universal APK (signed when keystore secrets exist, otherwise `-unsigned` suffix) → uploaded to the same draft                         |

Publishing: review the draft at GitHub Releases → edit notes → **Publish**.

## 4. Desktop updater signing (one-time setup)

ArcDrop's desktop auto-update uses Tauri's update signature scheme.

1. Generate the keypair (already generated once; the PRIVATE key is
   gitignored at `cross-platform/.updater-keys/`):

   ```sh
   cd cross-platform
   bun node_modules/@tauri-apps/cli/tauri.js signer generate -w .updater-keys/arcdrop-updater.key
   ```

2. Put the PRIVATE key into repository secrets:

   | Secret                               | Value                                           |
   | ------------------------------------ | ----------------------------------------------- |
   | `TAURI_SIGNING_PRIVATE_KEY`          | contents of `.updater-keys/arcdrop-updater.key` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty (key generated without password)          |

3. The PUBLIC key is already embedded in `src-tauri/tauri.conf.json`
   (`plugins.updater.pubkey`). If the keypair is ever regenerated, replace it.

Without the secret the release workflow disables updater artifacts and ships
unsigned bundles — users simply don't get in-app updates until a signed
release is cut.

## 5. Android release signing (one-time setup)

The share-target patch injects a conditional signing config into
`gen/android/app/build.gradle.kts`: the release build signs ONLY when
`ANDROID_KEYSTORE_FILE` is set, otherwise the artifact stays unsigned
(`-unsigned` suffix) and must be signed manually (Android Studio or
`apksigner`) before distribution.

Generate a keystore (keep it private, back it up — losing it means you can
never ship an update to the same applicationId):

```sh
keytool -genkeypair -v -keystore arcdrop-release.keystore \
  -alias arcdrop -keyalg RSA -keysize 2048 -validity 10000
```

Repository secrets:

| Secret                      | Value                                                         |
| --------------------------- | ------------------------------------------------------------- |
| `ANDROID_KEYSTORE_FILE`     | base64 of the keystore: `base64 -w0 arcdrop-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password                                             |
| `ANDROID_KEY_ALIAS`         | `arcdrop`                                                     |
| `ANDROID_KEY_PASSWORD`      | key password (usually same as keystore)                       |

## 6. Desktop updater flow (what the user sees)

Settings → Desktop → "Check for updates" → the app queries
`https://github.com/sametcn99/ArcDrop/releases/latest/download/latest.json`
→ "Update available — version X" → "Download & install" → "Restart ArcDrop
to apply". When the updater artifacts are disabled (unsigned releases), the
check reports the failure text and the manual download path is the GitHub
Release page.

---

## v0.1.0 draft release notes

> **ArcDrop v0.1.0 — first cross-platform release**
>
> The same ArcDrop web client, shipped as a native desktop and Android app.
> The UI opens from local files; you point it at your own self-hosted
> ArcDrop server — nothing is phone-home, nothing is centralized.
>
> **Highlights**
>
> - Desktop apps for Windows (MSI/NSIS), macOS (DMG) and Linux (AppImage/deb)
>   with window placement recall, system tray and optional start-with-system.
> - Android APK: share-target — share any link from another app straight into
>   ArcDrop's quick-add; shared files open the upload flow (up to 100 MB).
> - Runtime server address (Vaultwarden-style): one build works against any
>   ArcDrop server; the address is entered on first launch and changeable in
>   Settings.
> - CORS-free API access inside the Tauri shell (plugin-http) — the server
>   needs no CORS configuration.
> - Full client feature parity with the web app: library, collections, tags,
>   highlights, reminders with local notifications, portability (import/
>   export), library health, admin, 2FA, sessions with device labels.
> - Offline-resilient shell: the app always opens from local assets; when
>   the server is unreachable a clear retry/change-server screen appears and
>   your session survives.
> - Desktop auto-update (signed updates from GitHub Releases) — Android
>   updates via new APK releases on this page.
>
> **Known notes**
>
> - Android release artifacts are unsigned in v0.1.0 unless the signing
>   keystore was configured (see cross-platform/RELEASE.md).
> - Reminders fire while the app is in the foreground; OS-level background
>   scheduling (WorkManager) is planned.
> - iOS build is validated in CI but not distributed yet (App Store /
>   TestFlight requires Apple developer signing).
>
> **Install**
>
> - Windows: run the MSI (or NSIS setup). macOS: open the DMG and drag
>   ArcDrop to Applications. Linux: install the .deb or run the AppImage.
> - Android: download `app-universal-release.apk` and allow install from
>   this source (Play Store distribution is planned).
>
> **Checksums & signatures**: `.sig` files are Tauri updater signatures;
> SHA256 sums are published alongside the assets.

## Record platform acceptance

Record the build version, host or device model, OS version and result for each
platform before publishing. A CI compile or simulator build verifies that
target only.

| Platform | Installed artifact and flow to verify                                                     | Result |
| -------- | ----------------------------------------------------------------------------------------- | ------ |
| Windows  | Signed installer, same-origin login, deep link, file save and signed update               |        |
| macOS    | Signed and notarized bundle, same-origin login, deep link, file save and signed update    |        |
| Linux    | Published package on a supported desktop, login, tray, native file save and signed update |        |
| Android  | Signed APK on a physical device, share URL and file into ArcDrop, download and reminder   |        |
| iOS      | Installed build on a physical device, login, library sync and file picker                 |        |

Use the Compose web entry as the server address. Retest after restarting the
app and confirm that the configured server and session persist.
