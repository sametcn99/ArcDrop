namespace ArcDrop.Application.Ai;

/// <summary>
/// Provides AI provider configuration use cases for API endpoints.
/// </summary>
public interface IAiProviderConfigService
{
    /// <summary>
    /// Returns configured AI providers ordered for operator-facing API views.
    /// </summary>
    Task<IReadOnlyList<AiProviderConfigItem>> GetProvidersAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Returns one AI provider configuration by provider name, or null when no profile exists.
    /// </summary>
    Task<AiProviderConfigItem?> GetProviderAsync(string providerName, CancellationToken cancellationToken);

    /// <summary>
    /// Creates or replaces a provider profile.
    /// </summary>
    Task<AiProviderConfigMutationResult> UpsertProviderAsync(UpsertAiProviderConfigInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Updates an existing provider profile.
    /// </summary>
    Task<AiProviderConfigMutationResult> UpdateProviderAsync(UpdateAiProviderConfigInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Deletes a provider profile and returns whether a record was removed.
    /// </summary>
    Task<bool> DeleteProviderAsync(string providerName, CancellationToken cancellationToken);
}