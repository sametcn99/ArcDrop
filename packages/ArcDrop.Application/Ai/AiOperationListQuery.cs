namespace ArcDrop.Application.Ai;

/// <summary>
/// Defines a paged AI operation history query with optional provider and operation type filters.
/// </summary>
public sealed record AiOperationListQuery(
    int Page = 1,
    int PageSize = 20,
    string? ProviderName = null,
    string? OperationType = null)
{
    /// <summary>
    /// Upper bound applied to any caller-supplied page size to keep queries bounded.
    /// </summary>
    public const int MaxPageSize = 100;

    /// <summary>
    /// Returns a copy with page and page size clamped to safe bounds.
    /// </summary>
    public AiOperationListQuery Normalized()
    {
        return this with
        {
            Page = Math.Max(1, Page),
            PageSize = Math.Clamp(PageSize, 1, MaxPageSize)
        };
    }
}
