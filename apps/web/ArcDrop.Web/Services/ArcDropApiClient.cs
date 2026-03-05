using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Components.Authorization;

namespace ArcDrop.Web.Services;

/// <summary>
/// Implements ArcDrop API access with explicit authorization handling.
/// Protected requests read the bearer token from cookie-authenticated user claims.
/// </summary>
public sealed class ArcDropApiClient : IArcDropApiClient
{
    private const string AccessTokenClaimType = "arcdrop:access_token";
    private const string ExpiresAtClaimType = "arcdrop:expires_at_unix";

    private readonly HttpClient _httpClient;
    private readonly AuthenticationStateProvider _authenticationStateProvider;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public ArcDropApiClient(
        HttpClient httpClient,
        AuthenticationStateProvider authenticationStateProvider,
        IHttpContextAccessor httpContextAccessor)
    {
        _httpClient = httpClient;
        _authenticationStateProvider = authenticationStateProvider;
        _httpContextAccessor = httpContextAccessor;
    }

    /// <inheritdoc />
    public async Task<CurrentAdminResponse?> GetCurrentAdminAsync(CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var request = await CreateAuthorizedRequestAsync(HttpMethod.Get, "api/auth/me");
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                await SignOutCurrentRequestAsync();
                return null;
            }

            await EnsureSuccessOrThrowAsync(response, "Profile request", signOutOnUnauthorized: true, cancellationToken);

            return await response.Content.ReadFromJsonAsync<CurrentAdminResponse>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "Current admin response payload was empty.");
        }, "Could not load authenticated profile.");
    }

    /// <inheritdoc />
    public async Task RotatePasswordAsync(RotateAdminPasswordRequest request, CancellationToken cancellationToken)
    {
        await ExecuteAsync(async () =>
        {
            using var httpRequest = await CreateAuthorizedRequestAsync(HttpMethod.Post, "api/auth/rotate-password", request);
            using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Password rotation request", signOutOnUnauthorized: true, cancellationToken);
        }, "Could not rotate admin password.");
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<BookmarkDto>> GetBookmarksAsync(CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.GetAsync("api/bookmarks", cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Bookmark list request", signOutOnUnauthorized: false, cancellationToken);

            return await response.Content.ReadFromJsonAsync<List<BookmarkDto>>(cancellationToken: cancellationToken)
                ?? [];
        }, "Could not load bookmarks from ArcDrop API.");
    }

    /// <inheritdoc />
    public async Task<BookmarkDto?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.GetAsync($"api/bookmarks/{id}", cancellationToken);
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return null;
            }

            await EnsureSuccessOrThrowAsync(response, "Bookmark detail request", signOutOnUnauthorized: false, cancellationToken);
            return await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken);
        }, "Could not load bookmark details.");
    }

    /// <inheritdoc />
    public async Task<BookmarkDto> CreateBookmarkAsync(CreateBookmarkRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.PostAsJsonAsync("api/bookmarks", request, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Bookmark create request", signOutOnUnauthorized: false, cancellationToken);

            var payload = await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "Bookmark create response payload was empty.");

            return payload;
        }, "Could not create bookmark.");
    }

    /// <inheritdoc />
    public async Task<BookmarkDto> UpdateBookmarkAsync(Guid id, UpdateBookmarkRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.PutAsJsonAsync($"api/bookmarks/{id}", request, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Bookmark update request", signOutOnUnauthorized: false, cancellationToken);

            var payload = await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "Bookmark update response payload was empty.");

            return payload;
        }, "Could not update bookmark.");
    }

    /// <inheritdoc />
    public async Task DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken)
    {
        await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.DeleteAsync($"api/bookmarks/{id}", cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Bookmark delete request", signOutOnUnauthorized: false, cancellationToken);
        }, "Could not delete bookmark.");
    }

    /// <inheritdoc />
    public async Task<BookmarkDto> SyncBookmarkCollectionsAsync(Guid bookmarkId, IReadOnlyList<Guid> collectionIds, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.PutAsJsonAsync(
                $"api/bookmarks/{bookmarkId}/collections",
                new SyncBookmarkCollectionsRequest { CollectionIds = collectionIds },
                cancellationToken);

            await EnsureSuccessOrThrowAsync(response, "Bookmark collection sync request", signOutOnUnauthorized: false, cancellationToken);

            return await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "Bookmark collection sync response payload was empty.");
        }, "Could not update bookmark collections.");
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CollectionDto>> GetCollectionsAsync(CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.GetAsync("api/collections", cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Collection list request", signOutOnUnauthorized: false, cancellationToken);

            return await response.Content.ReadFromJsonAsync<List<CollectionDto>>(cancellationToken: cancellationToken)
                ?? [];
        }, "Could not load collections from ArcDrop API.");
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CollectionTreeNodeDto>> GetCollectionsTreeAsync(CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.GetAsync("api/collections/tree", cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Collection tree request", signOutOnUnauthorized: false, cancellationToken);

            return await response.Content.ReadFromJsonAsync<List<CollectionTreeNodeDto>>(cancellationToken: cancellationToken)
                ?? [];
        }, "Could not load collection tree from ArcDrop API.");
    }

    /// <inheritdoc />
    public async Task<CollectionDto> CreateCollectionAsync(CreateCollectionRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.PostAsJsonAsync("api/collections", request, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Collection create request", signOutOnUnauthorized: false, cancellationToken);

            return await response.Content.ReadFromJsonAsync<CollectionDto>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "Collection create response payload was empty.");
        }, "Could not create collection.");
    }

    /// <inheritdoc />
    public async Task<CollectionDto> UpdateCollectionAsync(Guid collectionId, UpdateCollectionRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.PutAsJsonAsync($"api/collections/{collectionId}", request, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Collection update request", signOutOnUnauthorized: false, cancellationToken);

            return await response.Content.ReadFromJsonAsync<CollectionDto>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "Collection update response payload was empty.");
        }, "Could not update collection.");
    }

    /// <inheritdoc />
    public async Task DeleteCollectionAsync(Guid collectionId, CancellationToken cancellationToken)
    {
        await ExecuteAsync(async () =>
        {
            using var response = await _httpClient.DeleteAsync($"api/collections/{collectionId}", cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "Collection delete request", signOutOnUnauthorized: false, cancellationToken);
        }, "Could not delete collection.");
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AiProviderConfigResponse>> GetAiProvidersAsync(CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var request = await CreateAuthorizedRequestAsync(HttpMethod.Get, "api/ai/providers");
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                await SignOutCurrentRequestAsync();
                throw new ApiClientException(ApiErrorKind.Unauthorized, "Session is not authorized. Sign in and retry.");
            }

            await EnsureSuccessOrThrowAsync(response, "AI provider list request", signOutOnUnauthorized: true, cancellationToken);

            return await response.Content.ReadFromJsonAsync<List<AiProviderConfigResponse>>(cancellationToken: cancellationToken)
                ?? [];
        }, "Could not load AI provider profiles.");
    }

    /// <inheritdoc />
    public async Task<AiProviderConfigResponse?> GetAiProviderByNameAsync(string providerName, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var request = await CreateAuthorizedRequestAsync(HttpMethod.Get, $"api/ai/providers/{Uri.EscapeDataString(providerName)}");
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return null;
            }

            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                await SignOutCurrentRequestAsync();
                throw new ApiClientException(ApiErrorKind.Unauthorized, "Session is not authorized. Sign in and retry.");
            }

            await EnsureSuccessOrThrowAsync(response, "AI provider detail request", signOutOnUnauthorized: true, cancellationToken);
            return await response.Content.ReadFromJsonAsync<AiProviderConfigResponse>(cancellationToken: cancellationToken);
        }, "Could not load AI provider profile.");
    }

    /// <inheritdoc />
    public async Task<AiProviderConfigResponse> UpsertAiProviderAsync(UpsertAiProviderConfigRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var httpRequest = await CreateAuthorizedRequestAsync(HttpMethod.Post, "api/ai/providers", request);
            using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "AI provider create request", signOutOnUnauthorized: true, cancellationToken);

            return await response.Content.ReadFromJsonAsync<AiProviderConfigResponse>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "AI provider create response payload was empty.");
        }, "Could not create AI provider profile.");
    }

    /// <inheritdoc />
    public async Task<AiProviderConfigResponse> UpdateAiProviderAsync(string providerName, UpdateAiProviderConfigRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var httpRequest = await CreateAuthorizedRequestAsync(HttpMethod.Put, $"api/ai/providers/{Uri.EscapeDataString(providerName)}", request);
            using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "AI provider update request", signOutOnUnauthorized: true, cancellationToken);

            return await response.Content.ReadFromJsonAsync<AiProviderConfigResponse>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "AI provider update response payload was empty.");
        }, "Could not update AI provider profile.");
    }

    /// <inheritdoc />
    public async Task DeleteAiProviderAsync(string providerName, CancellationToken cancellationToken)
    {
        await ExecuteAsync(async () =>
        {
            using var request = await CreateAuthorizedRequestAsync(HttpMethod.Delete, $"api/ai/providers/{Uri.EscapeDataString(providerName)}");
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "AI provider delete request", signOutOnUnauthorized: true, cancellationToken);
        }, "Could not delete AI provider profile.");
    }

    /// <inheritdoc />
    public async Task<OrganizeBookmarkResponse> OrganizeBookmarkAsync(OrganizeBookmarkRequest request, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var httpRequest = await CreateAuthorizedRequestAsync(HttpMethod.Post, "api/ai/organize", request);
            using var response = await _httpClient.SendAsync(httpRequest, cancellationToken);
            await EnsureSuccessOrThrowAsync(response, "AI organize request", signOutOnUnauthorized: true, cancellationToken);

            return await response.Content.ReadFromJsonAsync<OrganizeBookmarkResponse>(cancellationToken: cancellationToken)
                ?? throw new ApiClientException(ApiErrorKind.Client, "AI organization response payload was empty.");
        }, "Could not run AI organization request.");
    }

    /// <inheritdoc />
    public async Task<OrganizeBookmarkResponse?> GetOperationByIdAsync(Guid operationId, CancellationToken cancellationToken)
    {
        return await ExecuteAsync(async () =>
        {
            using var request = await CreateAuthorizedRequestAsync(HttpMethod.Get, $"api/ai/operations/{operationId}");
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                return null;
            }

            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                await SignOutCurrentRequestAsync();
                throw new ApiClientException(ApiErrorKind.Unauthorized, "Session is not authorized. Sign in and retry.");
            }

            await EnsureSuccessOrThrowAsync(response, "AI operation lookup request", signOutOnUnauthorized: true, cancellationToken);
            return await response.Content.ReadFromJsonAsync<OrganizeBookmarkResponse>(cancellationToken: cancellationToken);
        }, "Could not load AI operation details.");
    }

    private async Task<HttpRequestMessage> CreateAuthorizedRequestAsync(HttpMethod method, string requestUri, object? payload = null)
    {
        var message = new HttpRequestMessage(method, requestUri);
        var accessToken = await GetAccessTokenOrThrowAsync();

        // Every protected request fails closed when no valid token claim exists.
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        if (payload is not null)
        {
            message.Content = JsonContent.Create(payload);
        }

        return message;
    }

    private async Task EnsureSuccessOrThrowAsync(
        HttpResponseMessage response,
        string operationName,
        bool signOutOnUnauthorized,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            if (signOutOnUnauthorized)
            {
                await SignOutCurrentRequestAsync();
            }

            throw new ApiClientException(ApiErrorKind.Unauthorized, "Session is not authorized. Sign in and retry.");
        }

        var details = await SafeReadErrorAsync(response, cancellationToken);
        if ((int)response.StatusCode >= 500)
        {
            throw new ApiClientException(ApiErrorKind.Server, $"{operationName} failed because the API returned a server error ({(int)response.StatusCode}). {details}".Trim());
        }

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            throw new ApiClientException(ApiErrorKind.NotFound, $"{operationName} failed because the requested resource was not found.");
        }

        if (response.StatusCode == HttpStatusCode.BadRequest || response.StatusCode == HttpStatusCode.UnprocessableEntity)
        {
            throw new ApiClientException(ApiErrorKind.Validation, $"{operationName} failed validation. {details}".Trim());
        }

        throw new ApiClientException(ApiErrorKind.Server, $"{operationName} failed with status {(int)response.StatusCode}. {details}".Trim());
    }

    private static async Task<string> SafeReadErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        // Error bodies are optional; keep the message short to avoid leaking sensitive data in UI.
        var text = await response.Content.ReadAsStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(text))
        {
            return string.Empty;
        }

        var compact = text.Replace("\r", " ", StringComparison.Ordinal)
            .Replace("\n", " ", StringComparison.Ordinal)
            .Trim();

        return compact.Length > 180 ? compact[..180] : compact;
    }

    private static bool IsTimeout(Exception exception)
        => exception is TaskCanceledException;

    private async Task<string> GetAccessTokenOrThrowAsync()
    {
        var authState = await _authenticationStateProvider.GetAuthenticationStateAsync();
        var user = authState.User;

        if (user.Identity?.IsAuthenticated is not true)
        {
            throw new ApiClientException(ApiErrorKind.Unauthorized, "Authentication is required. Please sign in first.");
        }

        var accessToken = user.FindFirst(AccessTokenClaimType)?.Value;
        if (string.IsNullOrWhiteSpace(accessToken))
        {
            throw new ApiClientException(ApiErrorKind.Unauthorized, "Authentication token is unavailable. Please sign in again.");
        }

        var expiresAtClaim = user.FindFirst(ExpiresAtClaimType)?.Value;
        if (long.TryParse(expiresAtClaim, NumberStyles.Integer, CultureInfo.InvariantCulture, out var expiresAtUnix) &&
            DateTimeOffset.FromUnixTimeSeconds(expiresAtUnix) <= DateTimeOffset.UtcNow)
        {
            await SignOutCurrentRequestAsync();
            throw new ApiClientException(ApiErrorKind.Unauthorized, "Session has expired. Please sign in again.");
        }

        return accessToken;
    }

    private async Task SignOutCurrentRequestAsync()
    {
        var httpContext = _httpContextAccessor.HttpContext;
        if (httpContext is null)
        {
            return;
        }

        await httpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    }

    private static bool IsNetwork(Exception exception)
        => exception is HttpRequestException;

    private static ApiClientException WrapUnexpected(Exception exception, string fallbackMessage)
        => exception as ApiClientException
        ?? (IsTimeout(exception)
            ? new ApiClientException(ApiErrorKind.Timeout, "ArcDrop API request timed out. Please retry.", exception)
            : IsNetwork(exception)
                ? new ApiClientException(ApiErrorKind.Network, "Could not reach ArcDrop API. Verify backend is running and reachable.", exception)
                : new ApiClientException(ApiErrorKind.Client, fallbackMessage, exception));

    private static async Task<T> ExecuteAsync<T>(Func<Task<T>> operation, string fallbackMessage)
    {
        try
        {
            return await operation();
        }
        catch (Exception exception)
        {
            throw WrapUnexpected(exception, fallbackMessage);
        }
    }

    private static async Task ExecuteAsync(Func<Task> operation, string fallbackMessage)
    {
        try
        {
            await operation();
        }
        catch (Exception exception)
        {
            throw WrapUnexpected(exception, fallbackMessage);
        }
    }
}
