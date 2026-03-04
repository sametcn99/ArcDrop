namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents the join entity between bookmarks and tags.
/// Composite key enforcement prevents duplicate assignments.
/// </summary>
public sealed class BookmarkTag
{
    /// <summary>
    /// Foreign key referencing the bookmark side of the relationship.
    /// </summary>
    public Guid BookmarkId { get; set; }

    /// <summary>
    /// Foreign key referencing the tag side of the relationship.
    /// </summary>
    public Guid TagId { get; set; }

    /// <summary>
    /// Navigation to bookmark for relationship traversal.
    /// </summary>
    public Bookmark Bookmark { get; set; } = null!;

    /// <summary>
    /// Navigation to tag for relationship traversal.
    /// </summary>
    public Tag Tag { get; set; } = null!;
}
