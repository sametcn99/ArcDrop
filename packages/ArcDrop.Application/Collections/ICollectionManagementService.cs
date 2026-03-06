namespace ArcDrop.Application.Collections;

/// <summary>
/// Provides collection CRUD and hierarchy use cases for API endpoints.
/// </summary>
public interface ICollectionManagementService
{
    /// <summary>
    /// Returns all collections ordered for operator-facing API views.
    /// </summary>
    Task<IReadOnlyList<CollectionItem>> GetCollectionsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Returns the hierarchical collection tree with bookmark previews.
    /// </summary>
    Task<IReadOnlyList<CollectionTreeNodeItem>> GetCollectionTreeAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Creates a collection and returns validation status when creation fails.
    /// </summary>
    Task<CollectionMutationResult> CreateCollectionAsync(CreateCollectionInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Updates a collection and returns validation status when the operation fails.
    /// </summary>
    Task<CollectionMutationResult> UpdateCollectionAsync(UpdateCollectionInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Deletes a collection and reports whether blocking child items prevented removal.
    /// </summary>
    Task<CollectionDeleteResult> DeleteCollectionAsync(Guid id, CancellationToken cancellationToken);
}