# ArcDrop Avalonia Desktop Foundation Guide

Implements the Linux desktop client boundary defined in `.github/copilot-instructions.md` ("Linux path: Avalonia UI reusing shared core libraries") and extends the `FR-004` bookmark workflows plus `FR-002` fixed-admin authentication to a third client surface.

The Avalonia client reuses the shared `ArcDrop.Application` DTOs (`BookmarkListItem`, `BookmarkDetailItem`, `CreateBookmarkInput`, `UpdateBookmarkInput`) so the API contracts stay single-sourced across the Blazor web host, the MAUI client, and the Avalonia client.

## Covered Requirements

- Linux desktop path reserved by the monorepo layout (`apps/desktop/arcdrop-avalonia/`).
- `FR-002`: Fixed-admin sign-in with bearer token persistence and session-expiry fail-closed behavior.
- `FR-004`: Bookmark list with server-side search, create/edit with tags and collection membership, and two-step delete confirmation.
- `NFR-003`: The client consumes the paged bookmark list envelope and stats endpoint instead of assuming full hydration.

## Project Structure

- `apps/desktop/arcdrop-avalonia/ArcDrop.Avalonia`
  - `Services/` — auth session (file-backed under the OS application-data directory), authorized HTTP delegating handler, auth service, bookmark and collection API clients, and the navigation dispatcher.
  - `ViewModels/` — `ViewModelBase` plus `Login`, `Main` (shell), and the `Pages/` view models (`Dashboard`, `BookmarkList`, `BookmarkEdit`, `Settings`).
  - `Views/` — `LoginWindow`, `MainWindow` (sidebar navigation shell), and page controls resolved through `App.axaml` data templates.

## Feature Set

- **Sign-in gate**: unsigned or expired sessions boot into `LoginWindow`; successful logins persist the token and swap to the workspace shell.
- **Dashboard**: total and unassigned bookmark counters from `GET /api/bookmarks/stats`.
- **Bookmark list**: server-side search (`search` query parameter), row actions for edit and delete with a two-step confirmation that resets after three seconds.
- **Bookmark editor**: create and edit flows covering title, URL, summary, comma-separated tags, and an indented collection membership checklist.
- **Settings**: session status, API endpoint display, and sign-out returning to the login window.

## Configuration

The API base URL resolves from the `ARCDROP_Api__BaseUrl` environment variable and defaults to `http://localhost:5237/`, matching the web host and dev container defaults.

The session file lives at `<ApplicationData>/arcdrop-avalonia/session.json` and stores the username, access token, and expiry. Expired tokens fail closed to the login flow.

## Build and Run

Avalonia builds as a regular SDK project without platform workloads:

```powershell
dotnet build apps/desktop/arcdrop-avalonia/ArcDrop.Avalonia/ArcDrop.Avalonia.csproj
dotnet run --project apps/desktop/arcdrop-avalonia/ArcDrop.Avalonia/ArcDrop.Avalonia.csproj
```

On Linux the same commands produce the native desktop client; on Windows and macOS the client runs as an additional desktop surface alongside MAUI.

## Verification Notes

- Runtime flow verification seeds the session file and boots the client against a stub API; the request log must show `GET /api/bookmarks/stats` carrying the seeded `Authorization: Bearer` header.
- The full solution build still requires MAUI platform workloads (`maui-android` and friends); machines without them should build the API, web, Avalonia, and test projects individually.

## Next Avalonia Steps

- Collection tree browsing and inline collection management to reach parity with the web sidebar.
- AI provider configuration and organization surfaces mirrored from the web host.
- Tray/minimize-to-tray behavior and desktop notifications for background sync.
