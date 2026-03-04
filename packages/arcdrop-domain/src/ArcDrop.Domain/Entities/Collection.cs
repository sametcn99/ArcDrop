namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents a bookmark collection that groups bookmarks under a user-defined bucket.
/// </summary>
public sealed class Collection
{
    /// <summary>
    /// Stable identifier used by link tables and API contracts.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Collection display name shown in filters and navigation lists.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Optional collection description for context in detail screens.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// Creation timestamp in UTC for deterministic ordering.
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Last update timestamp in UTC for audit and synchronization scenarios.
    /// </summary>
    public DateTimeOffset UpdatedAtUtc { get; set; }

    /// <summary>
    /// Normalized many-to-many links to bookmarks.
    /// </summary>
    public ICollection<BookmarkCollectionLink> Bookmarks { get; set; } = new List<BookmarkCollectionLink>();
}
