namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents AI provider configuration output with secret values masked.
/// </summary>
public sealed record AiProviderConfigItem(
    Guid Id,
    string ProviderName,
    string ApiEndpoint,
    string Model,
    bool HasApiKey,
    string ApiKeyPreview,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);