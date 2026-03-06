namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents the outcome of deleting a collection.
/// </summary>
public sealed record CollectionDeleteResult(
    bool Deleted,
    bool NotFound,
    string? ValidationTarget,
    string? ValidationError);