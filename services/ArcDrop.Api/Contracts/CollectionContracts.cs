namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents a request to create a collection.
/// </summary>
/// <param name="Name">Collection display name.</param>
/// <param name="Description">Optional collection description.</param>
/// <param name="ParentId">Optional parent collection identifier for nested trees.</param>
public sealed record CreateCollectionRequest(string Name, string? Description, Guid? ParentId);

/// <summary>
/// Represents a request to update a collection.
/// </summary>
/// <param name="Name">Updated collection display name.</param>
/// <param name="Description">Updated optional description.</param>
/// <param name="ParentId">Updated optional parent collection identifier.</param>
public sealed record UpdateCollectionRequest(string Name, string? Description, Guid? ParentId);

/// <summary>
/// Represents a request that synchronizes one bookmark membership across multiple collections.
/// </summary>
/// <param name="CollectionIds">Target collection identifiers to be linked to the bookmark.</param>
public sealed record SyncBookmarkCollectionsRequest(IReadOnlyList<Guid> CollectionIds);

/// <summary>
/// Lightweight bookmark item used under collection tree nodes.
/// </summary>
public sealed record CollectionBookmarkItemResponse(Guid Id, string Title, string Url, DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Flat collection response used in CRUD views and selection lists.
/// </summary>
public sealed record CollectionResponse(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Tree-shaped collection response containing nested children and linked bookmark previews.
/// </summary>
public sealed record CollectionTreeNodeResponse(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<CollectionBookmarkItemResponse> Bookmarks,
    IReadOnlyList<CollectionTreeNodeResponse> Children);
