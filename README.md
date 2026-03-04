# ArcDrop

Self-host-first bookmarking platform with cross-platform desktop clients and AI-assisted organization.

## Repository Status

- Implements initial monorepo baseline (`FR-001`, `NFR-001`, `TASK-001`).
- Bootstraps API foundation (`FR-002`, `NFR-005`, `TASK-002`).
- Adds PostgreSQL schema, migration pipeline, and CRUD integration tests (`FR-003`, `TASK-003`).
- Adds fixed-admin JWT login baseline and authentication tests (`FR-002`, `TASK-004` baseline).
- Adds self-host Docker Compose assets and runbook baseline (`FR-002`, `NFR-002`, `TASK-012` baseline).
- Adds AI provider configuration lifecycle API (create/read/update/delete) with encrypted secret persistence (`FR-007`, `TASK-009`).
- Adds initial AI organization command and auditable operation logging endpoints (`FR-008`, `NFR-006`, `TASK-010` slice).
- Adds MAUI MVVM shell and route navigation foundation (`FR-005`, `TASK-005` slice).
- Adds MAUI bookmark add/list/detail/edit workflow slices using API-backed query and command services with resilient list fallback (`FR-004`, `TASK-006` slice).
- Adds Blazor web host pages for auth session management, bookmark CRUD, AI provider configuration, and AI organization operation lookup against backend APIs (`FR-002`, `FR-004`, `FR-007`, `FR-008`, `TASK-010` slice).
- Adds Blazor web host inside MAUI folder with bookmark add/list/edit flows against the same API contracts (`FR-004`, `TASK-006` web slice).

## Quick Navigation

- Monorepo rules: `docs/monorepo-structure.md`
- API bootstrap and migration guide: `docs/api-bootstrap.md`
- MAUI foundation guide: `docs/desktop-maui-foundation.md`
- Blazor web app: `apps/web/ArcDrop.Maui.Web`
- MAUI-related web host: `apps/web/ArcDrop.Maui.Web`
- Self-host quickstart: `docs/self-host-quickstart.md`
- Contributor guide: `CONTRIBUTING.md`
- Engineering guardrails: `.github/copilot-instructions.md`
- Implementation plans: `.github/plan/`
