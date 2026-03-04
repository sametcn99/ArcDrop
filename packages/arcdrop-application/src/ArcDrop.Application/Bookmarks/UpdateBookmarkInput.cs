namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents update input for bookmark edit operations.
/// </summary>
public sealed record UpdateBookmarkInput(
    Guid Id,
    string Url,
    string Title,
    string? Summary);
