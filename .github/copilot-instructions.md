# ArcDrop Engineering Instructions

## Mission
- Build ArcDrop as a self-host-first bookmarking platform.
- Preserve traceability to PRD IDs: `FR-*`, `NFR-*`, `AC-*`, `MILE-*`, `TASK-*`, `RISK-*`.
- Optimize for maintainability, auditability, and deterministic delivery quality.

## Technology Boundaries
- Backend: ASP.NET Core + PostgreSQL.
- Desktop: .NET MAUI (primary) with MVVM.
- Linux path: Avalonia UI reusing shared core libraries.
- Docs and landing: VitePress.
- Monorepo layout is mandatory: `apps/`, `services/`, `packages/`, `ops/`.

## Non-Negotiable Architecture Rules
- Keep UI frameworks presentation-only. No business logic in Views.
- Enforce dependency direction:
  1. `apps/*` and `services/*` may depend on `packages/*`.
  2. `packages/arcdrop-application` may depend on `packages/arcdrop-domain` and `packages/arcdrop-shared`.
  3. `packages/arcdrop-infrastructure` may depend on domain/application/shared.
  4. `packages/arcdrop-domain` must not depend on infrastructure or UI.
- Shared logic for MAUI and Avalonia must live in `packages/*`, not duplicated in app projects.
- Add architecture tests or guard checks for every new layer boundary introduced.

## Delivery Quality Gates
- Every implementation change must include:
  1. Requirement trace line in PR/notes (for example: `Implements FR-004, AC-004`).
  2. Test updates for changed behavior.
  3. Documentation updates for operator-facing or contributor-facing changes.
- No TODO placeholders without a linked task ID.
- Reject partial implementations that skip error handling and logging.

## Coding Standards
- Prefer explicit, readable code over compact clever code.
- Keep methods focused; split if a method has multiple responsibilities.
- All source code, identifiers, and user-facing UI text must be written in English.
- Code comments are mandatory for new or modified logic and must be written in clear English.
- Comments must explain intent, assumptions, edge cases, and failure behavior with practical detail.
- Use typed contracts and immutable DTO patterns where practical.
- Avoid hidden side effects. Functions should either return values or perform clear commands.

## Language And Comment Policy
- English-only policy is strict for:
  1. UI labels, messages, dialogs, and notifications.
  2. Source code identifiers (class, method, variable, constant names).
  3. Code comments, docstrings, and API descriptions.
  4. Contributor-facing artifacts in code changes (PR notes, commit summaries, runbooks updated in scope).
- Reject mixed-language additions in implementation files.

## Testing Policy
- Default expectation: unit tests + integration tests for service/data changes.
- Any PostgreSQL query or schema change must be covered by integration tests.
- Any API contract change must include request/response validation tests.
- Any MVVM workflow change must include ViewModel-level tests.
- Any AI workflow change must include adapter contract tests and failure path tests.

## Performance Targets
- Keep API list query p95 <= 300 ms at 50k bookmark scale (`NFR-003`).
- Keep desktop startup <= 3 seconds on reference hardware (`NFR-004`).
- When adding costly operations, include pagination, batching, or async workflow design.

## Security And Secrets
- Never commit secrets, tokens, provider keys, or credential seeds.
- Read sensitive values from environment variables or secure local secret store.
- Do not log raw secrets or full credential-like payloads.
- AI provider settings must be stored and transported with least-privilege principles.

## AI Integration Rules
- Route AI behavior through explicit provider adapter contracts.
- Apply ArcDrop system prompt policy before outbound provider calls.
- Log every AI operation with timestamp, operation type, and outcome (`NFR-006`).
- Handle provider capability differences explicitly (feature flags or capability checks).

## Documentation Rules
- Keep setup, architecture, and AI docs aligned with implementation.
- For behavior changes, update docs in the same change set when possible.
- Prefer operationally useful docs: quickstart, runbook, troubleshooting, constraints.

## Decision Priority
- If two approaches are possible, choose the one that best preserves:
  1. Requirement traceability.
  2. Architecture boundaries.
  3. Self-host reliability.
  4. Testability and auditability.
