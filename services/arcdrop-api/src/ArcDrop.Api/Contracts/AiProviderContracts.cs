namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents create or update input for an AI provider configuration profile.
/// </summary>
/// <param name="ProviderName">Unique provider profile name (for example: OpenAI).</param>
/// <param name="ApiEndpoint">Absolute API endpoint URL.</param>
/// <param name="Model">Model name used for generation calls.</param>
/// <param name="ApiKey">Raw provider API key input, encrypted before persistence.</param>
public sealed record UpsertAiProviderConfigRequest(string ProviderName, string ApiEndpoint, string Model, string ApiKey);

/// <summary>
/// Represents mutable fields for an existing AI provider configuration profile.
/// When <paramref name="ApiKey"/> is omitted, the existing encrypted key is preserved.
/// </summary>
/// <param name="ApiEndpoint">Absolute API endpoint URL.</param>
/// <param name="Model">Model name used for generation calls.</param>
/// <param name="ApiKey">Optional raw provider API key input, encrypted before persistence when provided.</param>
public sealed record UpdateAiProviderConfigRequest(string ApiEndpoint, string Model, string? ApiKey);

/// <summary>
/// Represents AI provider configuration output with secret values masked.
/// </summary>
public sealed record AiProviderConfigResponse(
    Guid Id,
    string ProviderName,
    string ApiEndpoint,
    string Model,
    bool HasApiKey,
    string ApiKeyPreview,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);
