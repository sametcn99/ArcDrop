namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents flat collection data used by CRUD and selection flows.
/// </summary>
public sealed record CollectionItem(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);