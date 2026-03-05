namespace ArcDrop.Web.Services;

/// <summary>
/// Defines bookmark list, create, and edit operations for the Blazor web host.
/// </summary>
public interface IBookmarkWebService
{
    Task<IReadOnlyList<BookmarkDto>> GetBookmarksAsync(CancellationToken cancellationToken);

    Task<BookmarkDto?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<BookmarkDto> CreateBookmarkAsync(CreateBookmarkRequest request, CancellationToken cancellationToken);

    Task<BookmarkDto> UpdateBookmarkAsync(Guid id, UpdateBookmarkRequest request, CancellationToken cancellationToken);
}
