---
description: "Use when implementing AI provider settings, adapters, prompt orchestration, model calls, or bookmark organization actions."
applyTo: "services/**, packages/arcdrop-application/**, packages/arcdrop-infrastructure/**"
---

# ArcDrop AI Integration Rules

- AI providers are user-owned integrations; do not assume ArcDrop-managed keys.
- Keep provider integration behind explicit adapter contracts.
- Normalize provider responses into ArcDrop domain contracts.

## Prompt And Workflow Rules

- Apply ArcDrop system prompt policy template before provider calls.
- Use explicit operation types: tag suggestions, collection suggestions, title or summary cleanup.
- Validate model output format before applying write operations.

## Reliability Rules

- Handle timeout, rate limit, and malformed output with typed failure states.
- Keep retries bounded and idempotent where possible.
- Provide fallback behavior when provider capability is missing.

## Audit Rules

- Log AI operation timestamp, operation type, provider, and success or failure outcome.
- Never persist raw secrets in logs or result records.

## Language And Comment Rules

- AI configuration labels, workflow messages, adapter names, and operation metadata must be English-only.
- Comments are mandatory for prompt construction, provider mapping logic, retries, and output validation rules.
- AI comments must be in English and describe assumptions, deterministic behavior boundaries, and failure handling.
