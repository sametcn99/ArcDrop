---
description: "Use when editing .NET backend, MAUI, Avalonia, domain, application, or infrastructure code. Enforces ArcDrop layering, MVVM, dependency direction, and shared-core boundaries."
applyTo: "services/**/*.cs, apps/desktop/**/*.cs, packages/**/*.cs"
---

# ArcDrop .NET Architecture Rules

- Keep strict layer boundaries:
  1. Presentation (MAUI/Avalonia/API controllers)
  2. Application (use cases, orchestration)
  3. Domain (entities, value objects, invariants)
  4. Infrastructure (database, external providers, IO)
- Do not reference infrastructure from domain.
- Do not put domain logic into code-behind or view classes.
- Keep constructor dependencies explicit and minimal.
- Enforce MVVM in MAUI/Avalonia:
  1. Views bind to ViewModels.
  2. ViewModels call application services.
  3. ViewModels do not call database or HTTP clients directly.

## Shared Core Contract

- Put reusable logic under `packages/arcdrop-*`.
- If same logic appears in MAUI and Avalonia, refactor into shared package.
- UI-specific mapping should stay in app layer, not in domain/application.

## Language And Comment Rules

- All code and UI content must be English-only.
- Class names, method names, variables, constants, and enums must use English naming.
- Comments are mandatory on newly added or changed logic blocks.
- Comments must be in English and include enough detail to explain purpose, decision rationale, and edge-case handling.
- Avoid placeholder comments; comments must provide implementation-relevant guidance.

## Service Layer Rules

- Controllers and endpoints should be thin.
- Validate inputs early and return typed errors.
- Use cancellation tokens on IO-bound async methods.
- Include structured logs for failure paths.

## Done Criteria For .NET Changes

- Architecture rule still holds after change.
- Tests cover new behavior and at least one failure path.
- Requirement IDs are referenced in commit/PR notes.
