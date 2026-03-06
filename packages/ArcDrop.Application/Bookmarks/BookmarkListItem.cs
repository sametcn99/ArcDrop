namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents bookmark list data projected for desktop list and search workflows.
/// This DTO keeps view models isolated from infrastructure and transport-specific models.
/// </summary>
public sealed record BookmarkListItem(
    Guid Id,
    string Url,
    string Title,
    string? Summary,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset? CreatedAtUtc = null,
    IReadOnlyList<Guid>? CollectionIds = null);
