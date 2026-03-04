---
description: "Use when writing or modifying tests, adding features, fixing bugs, or changing behavior. Enforces ArcDrop test depth, regression prevention, and acceptance-oriented quality gates."
applyTo: "**/*test*.*, **/*spec*.*, services/**, apps/**, packages/**"
---

# ArcDrop Testing And Quality Rules

- Every behavior change requires test updates.
- Prefer deterministic tests over timing-sensitive tests.
- Add positive, negative, and edge-case coverage.

## Minimum Coverage Expectations

- Domain rule changes: unit tests for invariants and value objects.
- API changes: integration tests for request validation, status codes, and persistence effects.
- Database changes: migration tests plus CRUD path verification.
- MVVM flow changes: ViewModel tests for command/state transitions.
- AI workflow changes: provider adapter contract tests and error handling tests.

## Regression Policy

- For each bug fix, add a test that fails before and passes after the fix.
- Keep test names behavior-focused and explicit.
- Avoid mock-heavy tests when integration contracts are core to risk.

## Language And Comment Rules

- Test names, assertions, test data labels, and helper identifiers must be English-only.
- Comments in test files are mandatory for setup intent, scenario purpose, and failure expectation when not obvious.
- All comments must be in English and should be detailed enough to make the test's behavior and intent auditable.

## Exit Gate

- Do not mark task done unless tests reflect changed behavior.
