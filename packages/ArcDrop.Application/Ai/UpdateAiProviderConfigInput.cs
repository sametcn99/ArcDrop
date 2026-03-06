namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents mutable fields for an existing AI provider configuration profile.
/// </summary>
public sealed record UpdateAiProviderConfigInput(string ProviderName, string ApiEndpoint, string Model, string? ApiKey);