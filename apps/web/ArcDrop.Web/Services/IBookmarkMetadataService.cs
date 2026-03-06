using System.Diagnostics.CodeAnalysis;

namespace ArcDrop.Web.Services;

/// <summary>
/// Resolves title and description metadata for one bookmark URL.
/// </summary>
public interface IBookmarkMetadataService
{
    Task<BookmarkMetadataPayload?> GetMetadataAsync(string bookmarkUrl, CancellationToken cancellationToken);
}

/// <summary>
/// Represents one metadata payload extracted from a bookmark document.
/// </summary>
public sealed record BookmarkMetadataPayload(string Title, string? Description);
