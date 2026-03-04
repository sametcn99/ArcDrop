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
    private readonly HttpClient _httpClient;
    private readonly ILogger<ApiBookmarkQueryService> _logger;

    public ApiBookmarkQueryService(HttpClient httpClient, ILogger<ApiBookmarkQueryService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    /// <summary>
    /// Retrieves bookmarks from API and applies client-side search filtering.
    /// Server-side filtering will be adopted when API query parameters are introduced.
    /// </summary>
    public async Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(string? searchTerm, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync("api/bookmarks", cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<List<ApiBookmarkResponse>>(cancellationToken: cancellationToken)
            ?? [];

        var projected = payload
            .Select(item => new BookmarkListItem(item.Id, item.Url, item.Title, item.Summary, item.UpdatedAtUtc))
            .ToList();

        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return projected;
        }

        var normalized = searchTerm.Trim();

        var filtered = projected
            .Where(item =>
                item.Title.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                item.Url.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                (item.Summary?.Contains(normalized, StringComparison.OrdinalIgnoreCase) ?? false))
            .ToList();

        _logger.LogInformation(
            "Bookmark API query returned {TotalCount} item(s), filtered to {FilteredCount} item(s) for search '{SearchTerm}'.",
            projected.Count,
            filtered.Count,
            normalized);

        return filtered;
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

    private sealed record ApiBookmarkResponse(
        Guid Id,
        string Url,
        string Title,
        string? Summary,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset UpdatedAtUtc);
}
