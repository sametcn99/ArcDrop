# ArcDrop API Bootstrap Guide

Implements `TASK-002`, `TASK-003`, `TASK-004`, `TASK-009`, and first `TASK-010` backend slice.

## Covered Requirements

- `FR-002`: Self-host backend foundation and fixed-admin authentication path.
- `FR-003`: PostgreSQL persistence for bookmark CRUD.
- `NFR-005`: Configuration supports secret injection through environment variables.
- `FR-007`: AI provider configuration endpoints with encrypted secret persistence.
- `FR-008`: AI organization command endpoint with ArcDrop system prompt template application.
- `NFR-006`: AI operation logs persisted with timestamp, operation type, and success/failure outcome.

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
- `DELETE /api/bookmarks/{id}`

## Migration Commands

Create a migration:

```powershell
dotnet dotnet-ef migrations add <MigrationName> --project packages/ArcDrop.Infrastructure/ArcDrop.Infrastructure.csproj --startup-project services/ArcDrop.Api/ArcDrop.Api.csproj --context ArcDrop.Infrastructure.Persistence.ArcDropDbContext --output-dir Persistence/Migrations
```

Apply migrations in a test or local workflow:

```powershell
dotnet dotnet-ef database update --project packages/ArcDrop.Infrastructure/ArcDrop.Infrastructure.csproj --startup-project services/ArcDrop.Api/ArcDrop.Api.csproj --context ArcDrop.Infrastructure.Persistence.ArcDropDbContext
```
