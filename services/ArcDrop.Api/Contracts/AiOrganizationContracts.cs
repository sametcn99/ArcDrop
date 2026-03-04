namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents a bookmark organization request executed against one configured AI provider profile.
/// </summary>
/// <param name="ProviderName">Configured provider profile name.</param>
/// <param name="OperationType">Operation type key (tag-suggestions, collection-suggestions, title-cleanup, summary-cleanup).</param>
/// <param name="BookmarkUrl">Bookmark URL payload.</param>
/// <param name="BookmarkTitle">Bookmark title payload.</param>
/// <param name="BookmarkSummary">Optional bookmark summary payload.</param>
public sealed record OrganizeBookmarkRequest(
    string ProviderName,
    string OperationType,
    string BookmarkUrl,
    string BookmarkTitle,
    string? BookmarkSummary);

/// <summary>
/// Represents one normalized suggestion produced by an organization action.
/// </summary>
public sealed record AiOperationResultResponse(
    string ResultType,
    string Value,
    decimal? Confidence);

/// <summary>
/// Represents organization action response including operation audit metadata.
/// </summary>
public sealed record OrganizeBookmarkResponse(
    Guid OperationId,
    string ProviderName,
    string OperationType,
    string OutcomeStatus,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc,
    IReadOnlyList<AiOperationResultResponse> Results);
