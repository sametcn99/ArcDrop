namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents the outcome of creating or updating an AI provider profile.
/// </summary>
public sealed record AiProviderConfigMutationResult(
    AiProviderConfigItem? Config,
    bool NotFound,
    string? ValidationTarget,
    string? ValidationError,
    bool Created = false);