namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents bookmark preview data projected under collection tree nodes.
/// </summary>
public sealed record CollectionBookmarkItem(
    Guid Id,
    string Title,
    string Url,
    DateTimeOffset UpdatedAtUtc);