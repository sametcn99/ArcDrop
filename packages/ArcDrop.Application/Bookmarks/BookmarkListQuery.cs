namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Defines a server-side bookmark list query with search, filtering, sorting, and paging.
/// This powers NFR-003-aligned list views so large libraries never require full client hydration.
/// </summary>
public sealed record BookmarkListQuery(
    string? Search = null,
    Guid? CollectionId = null,
    bool? UnassignedOnly = null,
    string? Tag = null,
    string? Sort = null,
    int Page = 1,
    int PageSize = 50)
{
    /// <summary>
    /// Upper bound applied to any caller-supplied page size to keep queries bounded.
    /// </summary>
    public const int MaxPageSize = 200;

    /// <summary>
    /// Returns a copy with page and page size clamped to safe bounds.
    /// </summary>
    public BookmarkListQuery Normalized()
    {
        return this with
        {
            Page = Math.Max(1, Page),
            PageSize = Math.Clamp(PageSize, 1, MaxPageSize)
        };
    }
}
