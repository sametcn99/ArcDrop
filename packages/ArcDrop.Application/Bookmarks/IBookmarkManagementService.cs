namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Provides bookmark CRUD and collection membership use cases for API endpoints.
/// </summary>
public interface IBookmarkManagementService
{
    /// <summary>
    /// Returns the latest bookmark list ordered for operator-facing API views.
    /// </summary>
    Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(CancellationToken cancellationToken);

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
    /// Deletes a bookmark and returns whether a record was removed.
    /// </summary>
    Task<bool> DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken);
}