# ArcDrop MAUI Foundation

Implements `TASK-005` foundation for `FR-005` and multi-step `FR-004` desktop bookmark flows while supporting `NFR-004` readiness work.

## Scope

This document describes the baseline MAUI shell architecture introduced for ArcDrop desktop work:

- MVVM folder split under `ViewModels`, `Views`, and `Services`.
- Shell-based route navigation through `INavigationService` abstraction.
- Dependency injection wiring for shell, views, view models, and navigation service.
- Starter pages (`DashboardPage`, `SettingsPage`) bound to view models.
- Bookmark list page with search/filter command flow (`BookmarkListPage`, `BookmarkListViewModel`).
- Bookmark detail and edit flow (`BookmarkDetailPage`, `BookmarkDetailViewModel`).
- Bookmark create flow (`CreateBookmarkPage`, `CreateBookmarkViewModel`).
- Application-layer bookmark query contract consumed by MAUI (`IBookmarkQueryService`).
- Application-layer bookmark command contract consumed by MAUI (`IBookmarkCommandService`).
- API-first bookmark query adapter with resilient seed fallback when backend is unavailable.
- API-backed bookmark create and update command adapters.

## Architecture Notes

- Views remain presentation-only and bind to view models.
- View models do not call database or HTTP layers directly.
- Navigation is abstracted to keep command handlers testable and avoid direct view coupling.
- Application/domain packages are referenced by the MAUI project to preserve dependency direction.

## Project Path

- `apps/desktop/ArcDrop.Maui`
- `apps/web/ArcDrop.Maui.Web`

## Build Command

```powershell
dotnet build apps/desktop/ArcDrop.Maui/ArcDrop.Maui.csproj -f net10.0-windows10.0.19041.0
```

Web host build:

```powershell
dotnet build apps/web/ArcDrop.Maui.Web/ArcDrop.Web.csproj
```

Web host run:

```powershell
dotnet run --project apps/web/ArcDrop.Maui.Web/ArcDrop.Web.csproj
```

Default web host URL in local development: `http://localhost:5290/bookmarks`.

## Runtime Configuration

- `ARCDROP_Api__BaseUrl`: Optional absolute base URL for ArcDrop API (default: `http://localhost:5000/`).
- Bookmark list workflows first query `GET /api/bookmarks`; if request fails, MAUI falls back to deterministic seed data.
- Bookmark create workflow uses `POST /api/bookmarks`.
- Bookmark detail and edit workflows use `GET /api/bookmarks/{id}` and `PUT /api/bookmarks/{id}`.

## Next MAUI Steps

- Add tag and collection editing support in detail workflows.
- Add list refresh trigger after create and edit completion.
- Add ViewModel-level tests for list filtering, loading states, and create or edit command transitions.
