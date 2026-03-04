---
name: ArcDrop Feature Implementation
description: "Plan and implement a feature with strict ArcDrop architecture, test, security, and documentation gates."
argument-hint: "Feature request + related FR/NFR/AC IDs"
agent: "agent"
---

Implement the requested ArcDrop feature using these constraints:

- Keep architecture boundaries intact (UI -> Application -> Domain -> Infrastructure).
- Preserve requirement traceability (`FR-*`, `NFR-*`, `AC-*`, `TASK-*`).
- Add or update tests for changed behavior and one failure path.
- Update docs if setup, architecture, or user-visible behavior changes.
- Include explicit error handling and structured logging.

Return:
1. Planned steps.
2. File-level changes.
3. Requirement coverage.
4. Validation summary.
