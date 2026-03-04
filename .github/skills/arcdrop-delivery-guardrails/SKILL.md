---
name: arcdrop-delivery-guardrails
description: "Use when implementing ArcDrop features, refactors, schema updates, AI workflows, or release-critical changes. Enforces requirement traceability, architecture boundaries, test gates, security checks, and docs updates before completion."
argument-hint: "Describe feature or change scope with FR/NFR/AC IDs"
---

# ArcDrop Delivery Guardrails

## When To Use
- Feature implementation in backend, desktop, shared packages, or docs.
- Refactor that may affect layering or dependency direction.
- PostgreSQL schema or query changes.
- AI provider integration or prompt orchestration updates.
- Any task tied to acceptance criteria or milestone exit.

## Required Inputs
- Intended requirement mapping (`FR-*`, `NFR-*`, `AC-*`, `TASK-*`, `MILE-*`).
- Affected modules and layers.
- Validation scope (tests, docs, operational notes).

## Procedure
1. Map the requested change to requirement IDs.
2. Confirm architecture boundaries are respected before coding.
3. Define test plan by risk level and affected layers.
4. Implement with explicit error handling and structured logging.
5. Verify security and secret handling constraints.
6. Update documentation if setup, architecture, or operator behavior changed.
7. Produce completion notes with traceability and residual risks.

## Mandatory Exit Checklist
- Requirement links are explicit in summary.
- Tests cover changed behavior and at least one failure path.
- No hardcoded secrets or secret leaks in logs.
- Architecture dependency direction is preserved.
- Docs are updated when behavior or operations change.

## References
- [Traceability Checklist](./references/traceability-checklist.md)
- [Architecture Checklist](./references/architecture-checklist.md)
- [Release Gate Checklist](./references/release-gate-checklist.md)
