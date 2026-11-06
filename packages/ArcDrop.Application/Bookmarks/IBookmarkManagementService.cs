namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Provides bookmark CRUD, tag, membership, and paged query use cases for API endpoints.
/// </summary>
public interface IBookmarkManagementService
{
    /// <summary>
    /// Returns one page of bookmarks matching the supplied search, filter, sort, and paging criteria.
    /// </summary>
    Task<BookmarkListResult> GetBookmarksAsync(BookmarkListQuery query, CancellationToken cancellationToken);

    /// <summary>
    /// Returns lightweight counters for navigation and dashboard surfaces.
    /// </summary>
    Task<BookmarkStats> GetBookmarkStatsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Returns one bookmark detail item by identifier, or null when the bookmark cannot be found.
    /// </summary>
    Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Creates a bookmark and returns the resulting detail projection.
    /// </summary>
    Task<BookmarkDetailItem> CreateBookmarkAsync(CreateBookmarkInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Updates a bookmark and returns the updated detail projection, or null when the bookmark cannot be found.
    /// </summary>
    Task<BookmarkDetailItem?> UpdateBookmarkAsync(UpdateBookmarkInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Synchronizes bookmark membership across collections.
    /// </summary>
    Task<BookmarkCollectionSyncResult> SyncCollectionsAsync(Guid bookmarkId, IReadOnlyList<Guid> collectionIds, CancellationToken cancellationToken);

    /// <summary>
    /// Synchronizes the exact tag set assigned to a bookmark and returns the updated projection,
    /// or null when the bookmark cannot be found.
    /// </summary>
    Task<BookmarkDetailItem?> SyncTagsAsync(Guid bookmarkId, IReadOnlyList<string> tagNames, CancellationToken cancellationToken);

    /// <summary>
    /// Returns all tags with usage counts ordered by name.
    /// </summary>
    Task<IReadOnlyList<TagItem>> GetTagsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Deletes a bookmark and returns whether a record was removed.
    /// </summary>
    Task<bool> DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken);
}
