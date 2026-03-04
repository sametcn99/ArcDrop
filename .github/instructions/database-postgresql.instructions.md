---
description: "Use when editing PostgreSQL schema, migrations, repositories, SQL queries, indexing strategy, or data access code for bookmarks, collections, tags, and AI logs."
applyTo: "services/**/*.sql, services/**/Migrations/**, packages/ArcDrop.Infrastructure/**, ops/docker/**"
---

# ArcDrop PostgreSQL Rules

- Schema updates must be migration-driven and reversible when possible.
- Preserve referential integrity across bookmarks, collections, and tags.
- Any migration that changes data shape must include rollback strategy notes.

## Data Model Guardrails

- Keep normalized links for many-to-many relations (`bookmark_tags`, collection links).
- Add indexes for high-frequency filters and joins.
- Use explicit transaction boundaries for multi-step writes.

## Query And Performance Rules

- Use pagination on list endpoints by default.
- Avoid unbounded queries in API paths.
- For new filters/search paths, include index impact analysis.
- Validate NFR target (`p95 <= 300 ms` at 50k bookmark scale) after meaningful query changes.

## Verification

- Run migration up/down checks in CI.
- Add integration tests for key CRUD and relationship operations.

## Language And Comment Rules

- SQL identifiers, migration names, and database-facing error messages must be English-only.
- Comments are mandatory for non-trivial SQL, indexing decisions, and migration data transformations.
- Database comments must be in English and explain intent, performance impact, and rollback or failure behavior.
