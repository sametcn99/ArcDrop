namespace ArcDrop.Web.Services;

/// <summary>
/// Defines all API operations required by the ArcDrop Blazor host for authentication,
/// bookmarks, AI provider configuration, and AI organization workflows.
/// </summary>
public interface IArcDropApiClient
{
    Task<CurrentAdminResponse?> GetCurrentAdminAsync(CancellationToken cancellationToken);

    Task RotatePasswordAsync(RotateAdminPasswordRequest request, CancellationToken cancellationToken);

    Task<IReadOnlyList<BookmarkDto>> GetBookmarksAsync(CancellationToken cancellationToken);

    Task<BookmarkDto?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<BookmarkDto> CreateBookmarkAsync(CreateBookmarkRequest request, CancellationToken cancellationToken);

    Task<BookmarkDto> UpdateBookmarkAsync(Guid id, UpdateBookmarkRequest request, CancellationToken cancellationToken);

    Task DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken);

    Task<BookmarkDto> SyncBookmarkCollectionsAsync(Guid bookmarkId, IReadOnlyList<Guid> collectionIds, CancellationToken cancellationToken);

    Task<IReadOnlyList<CollectionDto>> GetCollectionsAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<CollectionTreeNodeDto>> GetCollectionsTreeAsync(CancellationToken cancellationToken);

    Task<CollectionDto> CreateCollectionAsync(CreateCollectionRequest request, CancellationToken cancellationToken);

    Task<CollectionDto> UpdateCollectionAsync(Guid collectionId, UpdateCollectionRequest request, CancellationToken cancellationToken);

    Task DeleteCollectionAsync(Guid collectionId, CancellationToken cancellationToken);

    Task<IReadOnlyList<AiProviderConfigResponse>> GetAiProvidersAsync(CancellationToken cancellationToken);

    Task<AiProviderConfigResponse?> GetAiProviderByNameAsync(string providerName, CancellationToken cancellationToken);

    Task<AiProviderConfigResponse> UpsertAiProviderAsync(UpsertAiProviderConfigRequest request, CancellationToken cancellationToken);

    Task<AiProviderConfigResponse> UpdateAiProviderAsync(string providerName, UpdateAiProviderConfigRequest request, CancellationToken cancellationToken);

    Task DeleteAiProviderAsync(string providerName, CancellationToken cancellationToken);

    Task<OrganizeBookmarkResponse> OrganizeBookmarkAsync(OrganizeBookmarkRequest request, CancellationToken cancellationToken);

    Task<OrganizeBookmarkResponse?> GetOperationByIdAsync(Guid operationId, CancellationToken cancellationToken);

    /// <summary>
    /// Exports bookmarks and their collection assignments as a downloadable file in the requested format.
    /// Returns raw file bytes with content-type metadata for client-side download triggering.
    /// </summary>
    Task<(byte[] FileBytes, string ContentType, string FileName)> ExportBookmarksAsync(ExportBookmarksRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Imports bookmarks and collections from an uploaded file.
    /// Returns a summary of how many items were created, updated, or skipped.
    /// </summary>
    Task<ImportBookmarksResponse> ImportBookmarksAsync(Stream fileStream, string fileName, string format, CancellationToken cancellationToken);
}
