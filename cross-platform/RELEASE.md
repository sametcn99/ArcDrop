# ArcDrop releases

[GitHub Releases](https://github.com/sametcn99/ArcDrop/releases/latest) contains the desktop installers, Android packages, iOS Simulator app, browser extensions and self-hosted server images for each ArcDrop version. Download packages individually or use the all-bundles ZIP, then verify them against `SHA256SUMS`.

## Install a package

| Platform                | Package                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| Windows x64             | MSI or setup EXE                                                         |
| Windows ARM64           | Setup EXE                                                                |
| macOS                   | Universal DMG for Apple silicon and Intel                                |
| Linux x64 or ARM64      | AppImage or Debian package                                               |
| Android                 | Universal signed APK to install directly, or signed AAB for Play Console |
| iOS Simulator           | Apple silicon app ZIP                                                    |
| Chromium and Firefox    | [Extension ZIPs](../extension/README.md)                                 |
| Self-hosted web and API | Docker Compose bundle for Linux x64 or ARM64                             |

On macOS, open the DMG and move ArcDrop to Applications. These builds use ad hoc signing. Apple notarization and Windows Authenticode signing require platform credentials. Desktop updater signatures are separate and verified before publication.

For iOS Simulator, extract the ZIP, boot an iPhone simulator in Xcode, then run `xcrun simctl install booted ArcDrop.app` and `xcrun simctl launch booted com.arcdrop.client`. A physical iPhone requires an Apple-signed build and provisioning profile.

For a self-hosted server, extract the archive and follow its README. It includes the web, API and PostgreSQL images and a Compose configuration. After loading the images and creating `.env`, use `docker compose up -d --pull never --wait`.

## Publish a version

1. Run `bun --cwd=cross-platform run bump -- <version>` and `bun --cwd=extension run bump -- <version>`.
2. Set the same version in `apps/api/package.json` and `apps/web/app/package.json`. Run `cargo update --workspace` in `cross-platform/src-tauri` to update `Cargo.lock`.
3. Commit and push the version to `main`. Run [Release ArcDrop](https://github.com/sametcn99/ArcDrop/actions/workflows/release-cross-platform.yml) on `main`.

The workflow checks that application versions agree. It builds the platform packages, starts the self-hosted bundles from their packaged images, verifies Android and desktop updater signatures, then checks every uploaded release asset before publishing one GitHub Release. The release tag points to the exact workflow commit. The extension workflow can also build ZIPs without a release.

## Signing configuration

Desktop updates use the existing ArcDrop updater key pair. The repository secret `TAURI_SIGNING_PRIVATE_KEY` contains the private key and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` supplies its password when the key uses one. The corresponding public key lives in `src-tauri/tauri.conf.json`. The apps use the `latest.json` asset to find signed updates.

Android needs a stable release keystore for the `com.arcdrop.client` application ID. Back it up so subsequent APKs can update the installed app. Configure these repository secrets:

| Secret                      | Value                           |
| --------------------------- | ------------------------------- |
| `ANDROID_KEYSTORE_FILE`     | Base64-encoded release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password               |
| `ANDROID_KEY_ALIAS`         | Release key alias               |
| `ANDROID_KEY_PASSWORD`      | Release key password            |

## Verify on devices

After installing an artifact, connect to a self-hosted server, sign in, and verify library sync, downloads and session persistence across restart. Check deep links and the updater on desktop, and check URL and file sharing on Android. Record the build and device or OS version with the result.
