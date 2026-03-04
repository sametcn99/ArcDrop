---
name: ArcDrop PR Quality Gate
description: "Run a strict quality gate review for ArcDrop pull requests."
argument-hint: "PR diff or changed files"
agent: "agent"
---

Review the supplied change set with ArcDrop quality gates.

Check and report:
- Requirement traceability completeness.
- Architecture boundary compliance.
- Test adequacy and missing failure-path tests.
- Security and secret-handling regressions.
- Documentation update completeness.
- Performance risk against `NFR-003` and `NFR-004` when relevant.

Output findings first, ordered by severity, with file references.
