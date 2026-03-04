namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents a saved bookmark in ArcDrop.
/// This aggregate root stores user-curated link metadata and timestamps
/// that support list, filter, and edit flows in desktop clients.
/// </summary>
public sealed class Bookmark
{
    /// <summary>
    /// Stable identifier used across relations such as tags and collections.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Absolute bookmark URL provided by the user.
    /// URL normalization rules can be introduced later without changing schema identity.
    /// </summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>
    /// Human-readable title shown in list and detail views.
    /// </summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Optional descriptive summary used by AI cleanup and search helpers.
    /// </summary>
    public string? Summary { get; set; }

    /// <summary>
    /// Creation timestamp in UTC for sorting and audit-friendly timelines.
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Last update timestamp in UTC for conflict detection and synchronization.
    /// </summary>
    public DateTimeOffset UpdatedAtUtc { get; set; }

    /// <summary>
    /// Many-to-many tag links that keep tag ownership normalized.
    /// </summary>
    public ICollection<BookmarkTag> Tags { get; set; } = new List<BookmarkTag>();

    /// <summary>
    /// Many-to-many collection links that keep collection membership normalized.
    /// </summary>
    public ICollection<BookmarkCollectionLink> Collections { get; set; } = new List<BookmarkCollectionLink>();
}
