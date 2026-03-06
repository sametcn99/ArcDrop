namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents create or update input for an AI provider configuration profile.
/// </summary>
public sealed record UpsertAiProviderConfigInput(string ProviderName, string ApiEndpoint, string Model, string ApiKey);