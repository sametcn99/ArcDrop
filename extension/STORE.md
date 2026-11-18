# ArcDrop — Browser Extension Store Listing

Working notes for the Chrome Web Store / Firefox Add-ons (AMO) submissions
and the GitHub Releases page. Nothing here is automated — submissions are a
manual, user-driven step.

## Identity

- Name: **ArcDrop**
- Summary (≤132 chars):

  > Self-hosted bookmarking in your browser — save pages, links, images and
  > selections to your own ArcDrop server with one click.

- Category: Productivity / Tools
- Support: the user's own ArcDrop instance (self-hosted)

## Descriptions

### Short (Chrome summary / AMO summary)

> Save pages, links, images and selections to your self-hosted ArcDrop
> server. Full library, quick-save and keyboard shortcut included.

### Long

> ArcDrop is the browser companion of your self-hosted ArcDrop bookmark
> platform.
>
> SAVE FROM ANYWHERE
> • One click saves the current page with title, description, tags,
> collection and cover metadata handled by your server.
> • Right-click to save a page, a link, an image or the selected text.
> • Quick-save (Ctrl+Shift+S) stores the current page silently into your
> default collection.
> • "Save all tabs" archives every open page at once, skipping duplicates.
>
> YOUR SERVER, YOUR DATA
> • The extension talks only to the ArcDrop server you configure — setup
> asks for its address and signs you in (two-factor supported).
> • Browser-native requests go straight to your server; there is no
> third-party relay and no analytics of any kind.
> • The embedded ArcDrop app opens your full library in a tab without
> leaving the extension.
>
> ONE SESSION EVERYWHERE
> • Popup, options, embedded app and background share a single sign-in
> session with automatic token renewal handled in one place.
>
> Requires a running ArcDrop server (self-hosted, see the ArcDrop repository
> for setup).

## Privacy statement

ArcDrop stores your server address and session tokens locally in the
browser profile (chrome.storage.local) and exchanges data exclusively with
the ArcDrop server you configure during setup. The extension contains **no
analytics, no telemetry, no third-party requests** — every network call goes
to your own server. Page content is only read when you invoke a save action
(activeTab), and image saves additionally ask for one-time access to the
image's origin. Server-side metadata enrichment (titles, covers) is
performed by your own server, under its own SSRF protections.

## Permission justifications

| Permission                              | Why it is needed                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                               | Remembers your server address, session and preferences (quick-save target, theme, toggles) locally.                                                                                                                                          |
| `activeTab`                             | Reads the active page's URL/title (and injects the metadata collector) **only when you invoke the extension** — popup, shortcut or context menu. No background page scanning.                                                                |
| `contextMenus`                          | Adds "Save to ArcDrop" entries to the page/link/image/selection right-click menus.                                                                                                                                                           |
| `scripting`                             | Collects page metadata (og:title / og:description) on explicit save actions via `chrome.scripting.executeScript` with the already-granted activeTab access.                                                                                  |
| `optional_host_permissions` (`*://*/*`) | Setup requests access **only** to the server origin you enter, so API calls leave the browser CORS-free. Image saves request one-time access to the image's origin when used. No blanket "read all sites" access is ever requested up front. |

## Screenshots (store assets — taken manually, 1280×800)

1. Popup editor over an article page (save flow with tags + collection).
2. Popup "connected" state after a save (success state visible).
3. Embedded app page — library grid (from the "Open ArcDrop" button).
4. Embedded app page — bookmark detail drawer.
5. Context menu open on a page showing the ArcDrop entries.

Capture at 1280×800 (store minimum), PNG. Do not include private bookmark
data in the shots — use the local smoke instance with dummy data.

## Firefox (AMO) notes

- The manifest ships `browser_specific_settings.gecko` with
  `data_collection_permissions: { required: ["none"] }` (required by AMO
  since the data-consent policy).
- `arcdrop@arcdrop.dev` is the decided add-on id (kept as-is; update the
  firefox-prefixed block in `manifest.json` only if the user revisits it).
- AMO builds are unsigned zips; self-distribution works via "Install
  Add-on From File" on Firefox Developer/Nightly Edition (where
  `xpinstall.signatures.required` can be turned off), or via the store
  after signing.

## Release flow

1. `bun --cwd=extension run bump -- <version>` (updates manifest + package).
2. Commit, then push the tag: `git tag extension-v<version> && git push origin extension-v<version>`.
3. The `Release (Extension)` workflow builds, verifies and attaches
   `arcdrop-extension-chromium.zip` + `arcdrop-extension-firefox.zip` to a
   **draft** GitHub Release. Review, then publish.
