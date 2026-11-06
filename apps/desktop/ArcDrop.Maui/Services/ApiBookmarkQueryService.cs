using System.Net.Http.Json;
using ArcDrop.Application.Bookmarks;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Maui.Services;

/// <summary>
/// Loads bookmark list data from ArcDrop API endpoint for real desktop workflows.
/// This adapter keeps API contracts local to the MAUI layer and maps them to application DTOs.
/// </summary>
public sealed class ApiBookmarkQueryService
{
    private const int ListPageSize = 200;

    private readonly HttpClient _httpClient;
    private readonly ILogger<ApiBookmarkQueryService> _logger;

    public ApiBookmarkQueryService(HttpClient httpClient, ILogger<ApiBookmarkQueryService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    /// <summary>
    /// Retrieves one bookmark page from the API using server-side search filtering.
    /// </summary>
    public async Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(string? searchTerm, CancellationToken cancellationToken)
    {
        var requestUri = string.IsNullOrWhiteSpace(searchTerm)
            ? $"api/bookmarks?page=1&pageSize={ListPageSize}"
            : $"api/bookmarks?search={Uri.EscapeDataString(searchTerm.Trim())}&page=1&pageSize={ListPageSize}";

        using var response = await _httpClient.GetAsync(requestUri, cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<ApiBookmarkListResponse>(cancellationToken: cancellationToken)
            ?? new ApiBookmarkListResponse([], 0, 1, ListPageSize);

        var projected = payload.Items
            .Select(item => new BookmarkListItem(item.Id, item.Url, item.Title, item.Summary, item.UpdatedAtUtc))
            .ToList();

        _logger.LogInformation(
            "Bookmark API query returned {TotalCount} item(s) for search '{SearchTerm}' (page items: {PageItemCount}).",
            payload.TotalCount,
            searchTerm ?? string.Empty,
            projected.Count);

        return projected;
    }

    /// <summary>
    /// Retrieves one bookmark detail record by identifier.
    /// Returns null when API responds with not-found.
    /// </summary>
    public async Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync($"api/bookmarks/{id}", cancellationToken);

        if (response.StatusCode is System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<ApiBookmarkResponse>(cancellationToken: cancellationToken);
        if (payload is null)
        {
            return null;
        }

        return new BookmarkDetailItem(
            payload.Id,
            payload.Url,
            payload.Title,
            payload.Summary,
            payload.CreatedAtUtc,
            payload.UpdatedAtUtc);
    }

    private sealed record ApiBookmarkListResponse(
        IReadOnlyList<ApiBookmarkResponse> Items,
        int TotalCount,
        int Page,
        int PageSize);

    private sealed record ApiBookmarkResponse(
        Guid Id,
        string Url,
        string Title,
        string? Summary,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset UpdatedAtUtc);
}
