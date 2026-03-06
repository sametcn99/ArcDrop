namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents bookmark detail data required by edit workflows in desktop clients.
/// </summary>
public sealed record BookmarkDetailItem(
    Guid Id,
    string Url,
    string Title,
    string? Summary,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<Guid>? CollectionIds = null);
