---
description: "Use when handling authentication, credentials, configuration, secrets, AI provider settings, environment variables, and deployment scripts."
applyTo: "services/**, ops/**, **/*.env*, **/*config*.*, apps/**, packages/**"
---

# ArcDrop Security And Secret Handling Rules

- Never commit secrets or credential material.
- Never hardcode default production credentials.
- Use environment or secure local secret stores for sensitive data.

## Authentication Rules (v1 Fixed Admin)

- Treat fixed admin credentials as rotatable secrets.
- Implement explicit credential rotation path.
- Enforce minimum secret policy checks (length/entropy constraints).

## Logging Rules

- Do not log raw passwords, keys, tokens, or authorization headers.
- Mask sensitive fields in error payloads and diagnostics.
- Keep AI operation logs auditable without exposing secret inputs.

## AI Provider Config Rules

- Store provider credentials encrypted or externally referenced.
- Validate endpoint and model configuration before use.
- Fail closed when configuration is missing or invalid.

## Language And Comment Rules

- Security-related code, UI text, config keys, and validation messages must be English-only.
- Comments are mandatory for authentication, authorization, secret-handling, and cryptographic logic.
- Security comments must be in English and explain threat assumptions, failure modes, and safe-handling rationale.
