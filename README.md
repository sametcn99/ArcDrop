# ArcDrop

Self-host-first bookmarking platform with cross-platform desktop clients and AI-assisted organization.

## Repository Status

- Implements initial monorepo baseline (`FR-001`, `NFR-001`, `TASK-001`).
- Bootstraps API foundation (`FR-002`, `NFR-005`, `TASK-002`).
- Adds PostgreSQL schema, migration pipeline, and CRUD integration tests (`FR-003`, `TASK-003`).
- Adds fixed-admin JWT login baseline and authentication tests (`FR-002`, `TASK-004` baseline).
- Adds self-host Docker Compose assets and runbook baseline (`FR-002`, `NFR-002`, `TASK-012` baseline).
- Adds VS Code dev container onboarding for .NET 10, PostgreSQL, and shared workspace tooling (`FR-001`, `NFR-001`, `TASK-001` contributor environment slice).
- Adds AI provider configuration lifecycle API (create/read/update/delete) with encrypted secret persistence (`FR-007`, `TASK-009`).
- Adds initial AI organization command and auditable operation logging endpoints (`FR-008`, `NFR-006`, `TASK-010` slice).
- Adds MAUI MVVM shell and route navigation foundation (`FR-005`, `TASK-005` slice).
- Adds MAUI bookmark add/list/detail/edit workflow slices using API-backed query and command services with resilient list fallback (`FR-004`, `TASK-006` slice).
- Adds Blazor web host pages for auth session management, bookmark CRUD, AI provider configuration, and AI organization operation lookup against backend APIs (`FR-002`, `FR-004`, `FR-007`, `FR-008`, `TASK-010` slice).
- Secures web auth flow with server-issued HttpOnly session cookie, protected route redirects, and persistent refresh-safe sign-in behavior (`FR-002`).
- Requires admin authorization on all bookmark, collection, and data portability endpoints; the web and MAUI clients attach bearer tokens to every API call (`FR-002`).
- Adds server-side bookmark search, tag filtering, sorting, and paging with a paged list envelope plus bookmark stats counters (`FR-004`, `NFR-003`).
- Adds bookmark tags end to end: tag-aware contracts, exact-set tag sync endpoint, tag listing with usage counts, and one-click persistence of AI tag suggestions (`FR-004`, `FR-008`).
- Adds paged AI operation history endpoint and web history screen with type filtering (`NFR-006`).
- Completes web workspace UX: bookmark deletion and collection edit/delete with confirmations, tags UI, server-driven board paging, sidebar section navigation, layout-level sign-out, Settings hash deep links, self-hosted Bootstrap/Inter assets, dark mode, and accessibility improvements.
- Adds MAUI fixed-admin sign-in, bearer-attached API access, paged list handling, and session sign-out on the settings page.
- Adds the Avalonia Linux desktop client (`apps/desktop/arcdrop-avalonia`) reusing the shared application DTOs, with fixed-admin sign-in, session persistence, server-side bookmark search, create/edit with tags and collections, two-step deletes, and settings sign-out (`FR-002`, `FR-004`, Linux path boundary).

## Quick Navigation

- Monorepo rules: `docs/monorepo-structure.md`
- API bootstrap and migration guide: `docs/api-bootstrap.md`
- MAUI foundation guide: `docs/desktop-maui-foundation.md`
- Avalonia Linux client guide: `docs/desktop-avalonia-foundation.md`
- Blazor web app: `apps/web/ArcDrop.Web`
- API tests project: `tests/ArcDrop.Api.Tests`
- Self-host quickstart: `docs/self-host-quickstart.md`
- Dev container setup: `docs/devcontainer-setup.md`
- Contributor guide: `CONTRIBUTING.md`
