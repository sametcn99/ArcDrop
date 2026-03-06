namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents the outcome of a collection create or update operation.
/// The result keeps HTTP validation mapping outside the infrastructure implementation.
/// </summary>
public sealed record CollectionMutationResult(
    CollectionItem? Collection,
    string? ValidationTarget,
    string? ValidationError,
    bool NotFound = false);