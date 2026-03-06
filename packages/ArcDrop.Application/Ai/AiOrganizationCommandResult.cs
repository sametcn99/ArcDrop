namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents the outcome of executing one AI organization command.
/// </summary>
public sealed record AiOrganizationCommandResult(
    AiOrganizationOperationItem? Operation,
    bool ProviderFound,
    bool ProcessingFailed,
    string? ValidationTarget,
    string? ValidationError);