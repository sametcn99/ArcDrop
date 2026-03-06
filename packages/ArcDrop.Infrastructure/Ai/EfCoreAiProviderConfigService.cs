using ArcDrop.Application.Ai;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Infrastructure.Ai;

/// <summary>
/// Executes AI provider configuration workflows against EF Core persistence.
/// </summary>
public sealed class EfCoreAiProviderConfigService(
    ArcDropDbContext dbContext,
    IAiProviderSecretProtector secretProtector) : IAiProviderConfigService
{
    /// <inheritdoc />
    public async Task<IReadOnlyList<AiProviderConfigItem>> GetProvidersAsync(CancellationToken cancellationToken)
    {
        return await dbContext.AiProviderConfigs
            .AsNoTracking()
            .OrderByDescending(x => x.UpdatedAtUtc)
            .Select(x => new AiProviderConfigItem(
                x.Id,
                x.ProviderName,
                x.ApiEndpoint,
                x.Model,
                !string.IsNullOrWhiteSpace(x.ApiKeyCipherText),
                "****",
                x.CreatedAtUtc,
                x.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<AiProviderConfigItem?> GetProviderAsync(string providerName, CancellationToken cancellationToken)
    {
        var normalizedName = providerName.Trim();
        var config = await dbContext.AiProviderConfigs
            .AsNoTracking()
            .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

        return config is null ? null : MapConfig(config, "****");
    }

    /// <inheritdoc />
    public async Task<AiProviderConfigMutationResult> UpsertProviderAsync(UpsertAiProviderConfigInput input, CancellationToken cancellationToken)
    {
        var providerName = input.ProviderName.Trim();
        var existing = await dbContext.AiProviderConfigs
            .SingleOrDefaultAsync(x => x.ProviderName == providerName, cancellationToken);

        var utcNow = DateTimeOffset.UtcNow;
        var encryptedApiKey = secretProtector.Protect(input.ApiKey.Trim());
        var maskedPreview = secretProtector.CreateMaskedPreview(input.ApiKey.Trim());

        if (existing is null)
        {
            var entity = new AiProviderConfig
            {
                Id = Guid.NewGuid(),
                ProviderName = providerName,
                ApiEndpoint = input.ApiEndpoint.Trim(),
                Model = input.Model.Trim(),
                ApiKeyCipherText = encryptedApiKey,
                CreatedAtUtc = utcNow,
                UpdatedAtUtc = utcNow
            };

            dbContext.AiProviderConfigs.Add(entity);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new AiProviderConfigMutationResult(MapConfig(entity, maskedPreview), false, null, null, Created: true);
        }

        existing.ApiEndpoint = input.ApiEndpoint.Trim();
        existing.Model = input.Model.Trim();
        existing.ApiKeyCipherText = encryptedApiKey;
        existing.UpdatedAtUtc = utcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return new AiProviderConfigMutationResult(MapConfig(existing, maskedPreview), false, null, null);
    }

    /// <inheritdoc />
    public async Task<AiProviderConfigMutationResult> UpdateProviderAsync(UpdateAiProviderConfigInput input, CancellationToken cancellationToken)
    {
        var normalizedName = input.ProviderName.Trim();
        var config = await dbContext.AiProviderConfigs
            .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

        if (config is null)
        {
            return new AiProviderConfigMutationResult(null, true, null, null);
        }

        config.ApiEndpoint = input.ApiEndpoint.Trim();
        config.Model = input.Model.Trim();

        var apiKeyPreview = "****";
        var hasNewApiKey = !string.IsNullOrWhiteSpace(input.ApiKey);
        if (hasNewApiKey)
        {
            config.ApiKeyCipherText = secretProtector.Protect(input.ApiKey!.Trim());
            apiKeyPreview = secretProtector.CreateMaskedPreview(input.ApiKey.Trim());
        }

        config.UpdatedAtUtc = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return new AiProviderConfigMutationResult(MapConfig(config, apiKeyPreview), false, null, null);
    }

    /// <inheritdoc />
    public async Task<bool> DeleteProviderAsync(string providerName, CancellationToken cancellationToken)
    {
        var normalizedName = providerName.Trim();
        var config = await dbContext.AiProviderConfigs
            .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

        if (config is null)
        {
            return false;
        }

        dbContext.AiProviderConfigs.Remove(config);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static AiProviderConfigItem MapConfig(AiProviderConfig config, string apiKeyPreview)
    {
        return new AiProviderConfigItem(
            config.Id,
            config.ProviderName,
            config.ApiEndpoint,
            config.Model,
            !string.IsNullOrWhiteSpace(config.ApiKeyCipherText),
            apiKeyPreview,
            config.CreatedAtUtc,
            config.UpdatedAtUtc);
    }
}