namespace ArcDrop.Web.Services;

/// <summary>
/// Resolves a bookmark icon payload for one bookmark URL.
/// </summary>
public interface IBookmarkIconService
{
    Task<BookmarkIconPayload?> GetIconAsync(string bookmarkUrl, CancellationToken cancellationToken);
}

/// <summary>
/// Represents one resolved icon payload that can be streamed back to the browser.
/// </summary>
public sealed record BookmarkIconPayload(byte[] Content, string ContentType);