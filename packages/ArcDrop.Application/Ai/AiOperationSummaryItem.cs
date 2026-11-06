namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents one AI operation audit row without result payloads, used by history listings.
/// </summary>
public sealed record AiOperationSummaryItem(
    Guid OperationId,
    string ProviderName,
    string OperationType,
    string OutcomeStatus,
    string BookmarkTitle,
    string BookmarkUrl,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc);
