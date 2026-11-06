namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents one tag with its usage count for tag pickers and filters.
/// </summary>
public sealed record TagItem(Guid Id, string Name, int BookmarkCount);
