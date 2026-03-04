namespace ArcDrop.Web.Services;

/// <summary>
/// Defines all API operations required by the ArcDrop Blazor host for authentication,
/// bookmarks, AI provider configuration, and AI organization workflows.
/// </summary>
public interface IArcDropApiClient
{
    Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken);

    Task<CurrentAdminResponse?> GetCurrentAdminAsync(CancellationToken cancellationToken);

    Task RotatePasswordAsync(RotateAdminPasswordRequest request, CancellationToken cancellationToken);

    Task<IReadOnlyList<BookmarkDto>> GetBookmarksAsync(CancellationToken cancellationToken);

    Task<BookmarkDto?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken);

    Task<BookmarkDto> CreateBookmarkAsync(CreateBookmarkRequest request, CancellationToken cancellationToken);

    Task<BookmarkDto> UpdateBookmarkAsync(Guid id, UpdateBookmarkRequest request, CancellationToken cancellationToken);

    Task DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken);

    Task<IReadOnlyList<AiProviderConfigResponse>> GetAiProvidersAsync(CancellationToken cancellationToken);

    Task<AiProviderConfigResponse?> GetAiProviderByNameAsync(string providerName, CancellationToken cancellationToken);

    Task<AiProviderConfigResponse> UpsertAiProviderAsync(UpsertAiProviderConfigRequest request, CancellationToken cancellationToken);

    Task<AiProviderConfigResponse> UpdateAiProviderAsync(string providerName, UpdateAiProviderConfigRequest request, CancellationToken cancellationToken);

    Task DeleteAiProviderAsync(string providerName, CancellationToken cancellationToken);

    Task<OrganizeBookmarkResponse> OrganizeBookmarkAsync(OrganizeBookmarkRequest request, CancellationToken cancellationToken);

    Task<OrganizeBookmarkResponse?> GetOperationByIdAsync(Guid operationId, CancellationToken cancellationToken);
}
