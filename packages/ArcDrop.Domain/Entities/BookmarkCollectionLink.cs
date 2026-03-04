namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents the join entity between bookmarks and collections.
/// Composite key enforcement keeps collection membership unique per bookmark.
/// </summary>
public sealed class BookmarkCollectionLink
{
    /// <summary>
    /// Foreign key referencing the bookmark side of the relationship.
    /// </summary>
    public Guid BookmarkId { get; set; }

    /// <summary>
    /// Foreign key referencing the collection side of the relationship.
    /// </summary>
    public Guid CollectionId { get; set; }

    /// <summary>
    /// Navigation to bookmark for relationship traversal.
    /// </summary>
    public Bookmark Bookmark { get; set; } = null!;

    /// <summary>
    /// Navigation to collection for relationship traversal.
    /// </summary>
    public Collection Collection { get; set; } = null!;
}
