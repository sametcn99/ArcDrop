namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents a reusable tag assigned to one or more bookmarks.
/// </summary>
public sealed class Tag
{
    /// <summary>
    /// Stable identifier for relational mapping and external contracts.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Original tag text entered or generated for display.
    /// </summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Lower-cased normalized value used to enforce case-insensitive uniqueness.
    /// </summary>
    public string NameNormalized { get; set; } = string.Empty;

    /// <summary>
    /// Creation timestamp in UTC for deterministic ordering.
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Last update timestamp in UTC for update history and auditing.
    /// </summary>
    public DateTimeOffset UpdatedAtUtc { get; set; }

    /// <summary>
    /// Normalized many-to-many links to bookmarks.
    /// </summary>
    public ICollection<BookmarkTag> Bookmarks { get; set; } = new List<BookmarkTag>();
}
