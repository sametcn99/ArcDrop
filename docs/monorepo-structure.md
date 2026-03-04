# ArcDrop Monorepo Structure

Implements `TASK-001`, `FR-001`, `NFR-001`.

## Purpose

This document defines the mandatory folder conventions for ArcDrop. The goal is to keep domain boundaries clear, improve contributor onboarding, and prevent repository-root sprawl.

## Top-Level Layout

```text
/
  apps/
    desktop/
      arcdrop-maui/
      arcdrop-avalonia/
    web/
      arcdrop-docs/
    extensions/
  services/
    arcdrop-api/
  packages/
    arcdrop-domain/
    arcdrop-application/
    arcdrop-infrastructure/
    arcdrop-shared/
  ops/
    docker/
    scripts/
  tests/
```

## Ownership Rules

- `apps/*`: UI and presentation-layer composition.
- `services/*`: backend services and HTTP endpoints.
- `packages/arcdrop-domain`: entities, value objects, invariants.
- `packages/arcdrop-application`: use-case orchestration and contracts.
- `packages/arcdrop-infrastructure`: database adapters, external providers, and persistence concerns.
- `packages/arcdrop-shared`: cross-cutting primitives reused by multiple layers.
- `ops/*`: deployment and operations assets.
- `tests/*`: automated tests grouped by target area.

## Dependency Direction

1. `apps/*` and `services/*` may depend on `packages/*`.
2. `packages/arcdrop-application` may depend on domain/shared only.
3. `packages/arcdrop-infrastructure` may depend on domain/application/shared.
4. `packages/arcdrop-domain` must not depend on infrastructure or UI.

## Enforcement

- Architecture checks must be introduced as soon as first concrete domain/application/infrastructure implementations are added.
- Any folder convention change requires a corresponding update in this document and `CONTRIBUTING.md`.
