namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents the result of synchronizing bookmark-to-collection membership.
/// The result distinguishes missing bookmarks from invalid collection identifiers so HTTP callers can produce precise responses.
/// </summary>
public sealed record BookmarkCollectionSyncResult(
    bool BookmarkFound,
    bool AllCollectionsFound,
    BookmarkDetailItem? Bookmark);