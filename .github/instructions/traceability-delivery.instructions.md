---
description: "Use when planning, implementing, reviewing, or documenting ArcDrop tasks. Enforces strict traceability across PRD, roadmap, tasks, risks, and acceptance criteria."
applyTo: "**/*.md, services/**, apps/**, packages/**"
---

# ArcDrop Traceability Rules

- Each meaningful change should reference requirement IDs:
  1. Functional: `FR-*`
  2. Non-functional: `NFR-*`
  3. Acceptance: `AC-*`
  4. Task and roadmap: `TASK-*`, `MILE-*`
  5. Risk linkage when relevant: `RISK-*`

## Planning Rules

- Do not propose work items without requirement mapping.
- Include explicit definition of done aligned to acceptance criteria.
- Highlight risk impact when touching high-risk areas.

## Review Rules

- Reject changes with unclear requirement alignment.
- Reject changes that implement features without test and docs updates.
- Ensure architectural constraints remain intact after implementation.
- Enforce English-only language in traceability artifacts, PR summaries, and implementation notes.
- Require detailed English comments in modified logic so requirement-to-code mapping remains auditable.
