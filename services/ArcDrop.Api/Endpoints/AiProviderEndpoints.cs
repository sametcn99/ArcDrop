using ArcDrop.Api.Contracts;
using ArcDrop.Api.Security;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers AI provider configuration endpoints with encrypted API key persistence semantics.
/// </summary>
internal static class AiProviderEndpoints
{
    public static void MapAiProviders(WebApplication app)
    {
        var aiProviderGroup = app.MapGroup("/api/ai/providers").RequireAuthorization();

        aiProviderGroup.MapGet("/", async (ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var providers = await dbContext.AiProviderConfigs
                .AsNoTracking()
                .OrderByDescending(x => x.UpdatedAtUtc)
                .Select(x => new AiProviderConfigResponse(
                    x.Id,
                    x.ProviderName,
                    x.ApiEndpoint,
                    x.Model,
                    HasApiKey: !string.IsNullOrWhiteSpace(x.ApiKeyCipherText),
                    ApiKeyPreview: "****",
                    x.CreatedAtUtc,
                    x.UpdatedAtUtc))
                .ToListAsync(cancellationToken);

            return Results.Ok(providers);
        });

        aiProviderGroup.MapPost("/", async (
            UpsertAiProviderConfigRequest request,
            ArcDropDbContext dbContext,
            IAiProviderSecretProtector secretProtector,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.ProviderName) ||
                string.IsNullOrWhiteSpace(request.ApiEndpoint) ||
                string.IsNullOrWhiteSpace(request.Model) ||
                string.IsNullOrWhiteSpace(request.ApiKey))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.ProviderName)] = ["Provider name is required."],
                    [nameof(request.ApiEndpoint)] = ["API endpoint is required."],
                    [nameof(request.Model)] = ["Model is required."],
                    [nameof(request.ApiKey)] = ["API key is required."]
                });
            }

            if (!Uri.TryCreate(request.ApiEndpoint, UriKind.Absolute, out _))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.ApiEndpoint)] = ["A valid absolute API endpoint is required."]
                });
            }

            var providerName = request.ProviderName.Trim();
            var existing = await dbContext.AiProviderConfigs
                .SingleOrDefaultAsync(x => x.ProviderName == providerName, cancellationToken);

            var utcNow = DateTimeOffset.UtcNow;
            var encryptedApiKey = secretProtector.Protect(request.ApiKey.Trim());

            if (existing is null)
            {
                var entity = new AiProviderConfig
                {
                    Id = Guid.NewGuid(),
                    ProviderName = providerName,
                    ApiEndpoint = request.ApiEndpoint.Trim(),
                    Model = request.Model.Trim(),
                    ApiKeyCipherText = encryptedApiKey,
                    CreatedAtUtc = utcNow,
                    UpdatedAtUtc = utcNow
                };

                dbContext.AiProviderConfigs.Add(entity);
                await dbContext.SaveChangesAsync(cancellationToken);

                return Results.Created(
                    $"/api/ai/providers/{Uri.EscapeDataString(entity.ProviderName)}",
                    new AiProviderConfigResponse(
                        entity.Id,
                        entity.ProviderName,
                        entity.ApiEndpoint,
                        entity.Model,
                        HasApiKey: true,
                        ApiKeyPreview: secretProtector.CreateMaskedPreview(request.ApiKey.Trim()),
                        entity.CreatedAtUtc,
                        entity.UpdatedAtUtc));
            }

            existing.ApiEndpoint = request.ApiEndpoint.Trim();
            existing.Model = request.Model.Trim();
            existing.ApiKeyCipherText = encryptedApiKey;
            existing.UpdatedAtUtc = utcNow;

            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.Ok(new AiProviderConfigResponse(
                existing.Id,
                existing.ProviderName,
                existing.ApiEndpoint,
                existing.Model,
                HasApiKey: true,
                ApiKeyPreview: secretProtector.CreateMaskedPreview(request.ApiKey.Trim()),
                existing.CreatedAtUtc,
                existing.UpdatedAtUtc));
        });

        aiProviderGroup.MapGet("/{providerName}", async (
            string providerName,
            ArcDropDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            var normalizedName = providerName.Trim();
            var config = await dbContext.AiProviderConfigs
                .AsNoTracking()
                .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

            if (config is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(new AiProviderConfigResponse(
                config.Id,
                config.ProviderName,
                config.ApiEndpoint,
                config.Model,
                HasApiKey: !string.IsNullOrWhiteSpace(config.ApiKeyCipherText),
                ApiKeyPreview: "****",
                config.CreatedAtUtc,
                config.UpdatedAtUtc));
        });

        // Update endpoint allows endpoint/model edits without forcing API key re-entry.
        aiProviderGroup.MapPut("/{providerName}", async (
            string providerName,
            UpdateAiProviderConfigRequest request,
            ArcDropDbContext dbContext,
            IAiProviderSecretProtector secretProtector,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.ApiEndpoint) || string.IsNullOrWhiteSpace(request.Model))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.ApiEndpoint)] = ["API endpoint is required."],
                    [nameof(request.Model)] = ["Model is required."]
                });
            }

            if (!Uri.TryCreate(request.ApiEndpoint, UriKind.Absolute, out _))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.ApiEndpoint)] = ["A valid absolute API endpoint is required."]
                });
            }

            var normalizedName = providerName.Trim();
            var config = await dbContext.AiProviderConfigs
                .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

            if (config is null)
            {
                return Results.NotFound();
            }

            config.ApiEndpoint = request.ApiEndpoint.Trim();
            config.Model = request.Model.Trim();

            var hasNewApiKey = !string.IsNullOrWhiteSpace(request.ApiKey);
            if (hasNewApiKey)
            {
                config.ApiKeyCipherText = secretProtector.Protect(request.ApiKey!.Trim());
            }

            config.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);

            var apiKeyPreview = hasNewApiKey
                ? secretProtector.CreateMaskedPreview(request.ApiKey!.Trim())
                : "****";

            return Results.Ok(new AiProviderConfigResponse(
                config.Id,
                config.ProviderName,
                config.ApiEndpoint,
                config.Model,
                HasApiKey: !string.IsNullOrWhiteSpace(config.ApiKeyCipherText),
                ApiKeyPreview: apiKeyPreview,
                config.CreatedAtUtc,
                config.UpdatedAtUtc));
        });

        aiProviderGroup.MapDelete("/{providerName}", async (
            string providerName,
            ArcDropDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            var normalizedName = providerName.Trim();
            var config = await dbContext.AiProviderConfigs
                .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

            if (config is null)
            {
                return Results.NotFound();
            }

            dbContext.AiProviderConfigs.Remove(config);
            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.NoContent();
        });
    }
}
