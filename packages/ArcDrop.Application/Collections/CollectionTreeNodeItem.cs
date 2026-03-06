namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents tree-shaped collection data containing nested children and bookmark previews.
/// </summary>
public sealed record CollectionTreeNodeItem(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<CollectionBookmarkItem> Bookmarks,
    IReadOnlyList<CollectionTreeNodeItem> Children);