# ArcDrop API Bootstrap Guide

Implements `TASK-002`, `TASK-003`, `TASK-004`, `TASK-009`, and first `TASK-010` backend slice.
The latest update extends this bootstrap with hierarchical collections, bookmark-to-collection synchronization, and automated OpenAPI documentation surfaced through Scalar.

## Covered Requirements

- `FR-002`: Self-host backend foundation and fixed-admin authentication path.
- `FR-003`: PostgreSQL persistence for bookmark CRUD.
- `NFR-005`: Configuration supports secret injection through environment variables.
- `FR-007`: AI provider configuration endpoints with encrypted secret persistence.
- `FR-008`: AI organization command endpoint with ArcDrop system prompt template application.
- `FR-004`: Collection hierarchy and bookmark-to-collection membership management.
- `NFR-006`: AI operation logs persisted with timestamp, operation type, and success/failure outcome.
- `FR-002`: Self-host operators can inspect the API contract through generated OpenAPI and interactive reference docs.

## Configuration

The API loads `ARCDROP_`-prefixed environment variables in addition to `appsettings` files.

Important settings:

- `ARCDROP_ConnectionStrings__ArcDropPostgres`
- `ARCDROP_Admin__Username`
- `ARCDROP_Admin__Password`
- `ARCDROP_AdminCredentialPolicy__MinimumPasswordLength`
- `ARCDROP_AdminCredentialPolicy__RequireUppercase`
- `ARCDROP_AdminCredentialPolicy__RequireLowercase`
- `ARCDROP_AdminCredentialPolicy__RequireDigit`
- `ARCDROP_AdminCredentialPolicy__RequireSpecialCharacter`
- `ARCDROP_AdminCredentialPolicy__DisallowPasswordReuse`
- `ARCDROP_Jwt__Issuer`
- `ARCDROP_Jwt__Audience`
- `ARCDROP_Jwt__SigningKey`
- `ARCDROP_Jwt__AccessTokenLifetimeMinutes`

## Endpoints

- `GET /health`: service health and admin configuration detection.
- `GET /openapi/v1.json`: generated OpenAPI document for tooling, integration, and documentation flows.
- `GET /docs`: Scalar interactive API reference backed by the generated OpenAPI document.
- `POST /api/auth/login`: fixed-admin login and JWT token issuance.
- `GET /api/auth/me`: authenticated profile check.
- `POST /api/auth/rotate-password`: authenticated fixed-admin password rotation.
- `GET /api/ai/providers`: list configured AI providers with masked secrets.
- `POST /api/ai/providers`: create or update AI provider settings with encrypted API key storage.
- `GET /api/ai/providers/{providerName}`: read single AI provider configuration with masked secret preview.
- `PUT /api/ai/providers/{providerName}`: update endpoint/model and optionally rotate API key.
- `DELETE /api/ai/providers/{providerName}`: remove AI provider configuration profile.
- `POST /api/ai/organize`: run bookmark organization action and persist operation audit records.
- `GET /api/ai/operations/{operationId}`: read operation outcome and generated structured results.
- `GET /api/bookmarks`
- `GET /api/bookmarks/{id}`
- `POST /api/bookmarks`
- `PUT /api/bookmarks/{id}`
- `PUT /api/bookmarks/{id}/collections`: synchronize one bookmark across multiple collection IDs.
- `DELETE /api/bookmarks/{id}`
- `GET /api/collections`: list all collections as flat rows.
- `GET /api/collections/tree`: list collections as a nested tree with bookmarked items under each node.
- `POST /api/collections`: create a root or child collection.
- `PUT /api/collections/{id}`: update collection metadata and parent assignment with cycle protection.
- `DELETE /api/collections/{id}`: delete a collection when no child collections remain.

## API Documentation

The API publishes its contract in two automated forms:

- Runtime document: `GET /openapi/v1.json`
- Interactive reference UI: `GET /docs`

The document is generated from Minimal API metadata at runtime and also emitted during build through `Microsoft.Extensions.ApiDescription.Server`. Build-time generation is guarded so the document pipeline does not try to run PostgreSQL migrations while resolving the contract.

Generated metadata now includes:

- Stable operation IDs for client generation and contract diffs.
- Route summaries and detailed descriptions grouped by domain tags.
- Request body metadata for JSON and multipart endpoints.
- Explicit success, validation, authentication, authorization, not-found, and problem response metadata where applicable.

## Migration Commands

Create a migration:

```powershell
dotnet dotnet-ef migrations add <MigrationName> --project packages/ArcDrop.Infrastructure/ArcDrop.Infrastructure.csproj --startup-project services/ArcDrop.Api/ArcDrop.Api.csproj --context ArcDrop.Infrastructure.Persistence.ArcDropDbContext --output-dir Persistence/Migrations
```

Apply migrations in a test or local workflow:

```powershell
dotnet dotnet-ef database update --project packages/ArcDrop.Infrastructure/ArcDrop.Infrastructure.csproj --startup-project services/ArcDrop.Api/ArcDrop.Api.csproj --context ArcDrop.Infrastructure.Persistence.ArcDropDbContext
```
