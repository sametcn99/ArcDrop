namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Provides bookmark mutation use-cases consumed by desktop view models.
/// </summary>
public interface IBookmarkCommandService
{
    /// <summary>
    /// Creates a bookmark and returns the resulting detail projection.
    /// </summary>
    Task<BookmarkDetailItem> CreateBookmarkAsync(CreateBookmarkInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Updates a bookmark and returns the updated detail projection.
    /// </summary>
    Task<BookmarkDetailItem> UpdateBookmarkAsync(UpdateBookmarkInput input, CancellationToken cancellationToken);
}
