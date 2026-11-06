namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents one page of AI operation audit history together with paging metadata.
/// </summary>
public sealed record AiOperationListResult(
    IReadOnlyList<AiOperationSummaryItem> Items,
    int TotalCount,
    int Page,
    int PageSize);
