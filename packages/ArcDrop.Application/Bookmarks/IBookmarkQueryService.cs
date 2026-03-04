namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Provides bookmark query use-cases consumed by desktop view models.
/// Implementations may use API calls, local cache, or offline stores while preserving a stable contract.
/// </summary>
public interface IBookmarkQueryService
{
    /// <summary>
    /// Returns bookmarks filtered by an optional search term.
    /// Search behavior is case-insensitive and implementation-defined for ranking.
    /// </summary>
    Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(string? searchTerm, CancellationToken cancellationToken);

    /// <summary>
    /// Returns one bookmark detail item by identifier, or null when the item cannot be found.
    /// </summary>
    Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken);
}
