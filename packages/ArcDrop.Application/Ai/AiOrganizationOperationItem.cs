namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents an auditable AI organization operation and its persisted results.
/// </summary>
public sealed record AiOrganizationOperationItem(
    Guid OperationId,
    string ProviderName,
    string OperationType,
    string OutcomeStatus,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc,
    IReadOnlyList<AiOrganizationResultItem> Results);