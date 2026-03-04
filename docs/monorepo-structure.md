# ArcDrop Monorepo Structure

Implements `TASK-001`, `FR-001`, `NFR-001`.

## Purpose

This document defines the mandatory folder conventions for ArcDrop. The goal is to keep domain boundaries clear, improve contributor onboarding, and prevent repository-root sprawl.

## Top-Level Layout

```text
/
  apps/
    desktop/
      ArcDrop.Maui/
      arcdrop-avalonia/
    web/
      arcdrop-docs/
      ArcDrop.Maui.Web/
    extensions/
  services/
    ArcDrop.Api/
  packages/
    ArcDrop.Domain/
    ArcDrop.Application/
    ArcDrop.Infrastructure/
    ArcDrop.Shared/
  ops/
    docker/
    scripts/
  tests/
```

## Ownership Rules

- `apps/*`: UI and presentation-layer composition.
- `services/*`: backend services and HTTP endpoints.
- `packages/ArcDrop.Domain`: entities, value objects, invariants.
- `packages/ArcDrop.Application`: use-case orchestration and contracts.
- `packages/ArcDrop.Infrastructure`: database adapters, external providers, and persistence concerns.
- `packages/ArcDrop.Shared`: cross-cutting primitives reused by multiple layers.
- `ops/*`: deployment and operations assets.
- `tests/*`: automated tests grouped by target area.

## Dependency Direction

1. `apps/*` and `services/*` may depend on `packages/*`.
2. `packages/ArcDrop.Application` may depend on domain/shared only.
3. `packages/ArcDrop.Infrastructure` may depend on domain/application/shared.
4. `packages/ArcDrop.Domain` must not depend on infrastructure or UI.

## Enforcement

- Architecture checks must be introduced as soon as first concrete domain/application/infrastructure implementations are added.
- Any folder convention change requires a corresponding update in this document and `CONTRIBUTING.md`.
