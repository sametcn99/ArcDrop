namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents one page of bookmark list results together with paging metadata.
/// </summary>
public sealed record BookmarkListResult(
    IReadOnlyList<BookmarkListItem> Items,
    int TotalCount,
    int Page,
    int PageSize);
