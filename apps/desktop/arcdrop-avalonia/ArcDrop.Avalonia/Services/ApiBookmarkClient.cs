using System.Net;
using System.Net.Http.Json;
using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Avalonia.Services;

/// <summary>
/// Typed ArcDrop API client for bookmark workflows on the Linux desktop client.
/// All data endpoints require the admin bearer token attached by the authorized handler.
/// </summary>
public sealed class ApiBookmarkClient(HttpClient httpClient)
{
    private const int ListPageSize = 200;

    private sealed record BookmarkListResponse(
        IReadOnlyList<BookmarkResponse> Items,
        int TotalCount,
        int Page,
        int PageSize);

    private sealed record BookmarkStatsResponse(int TotalCount, int UnassignedCount);

    private sealed record BookmarkResponse(
        Guid Id,
        string Url,
        string Title,
        string? Summary,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset UpdatedAtUtc,
        IReadOnlyList<Guid> CollectionIds,
        IReadOnlyList<string>? Tags);

    private sealed record CreateBookmarkRequest(string Url, string Title, string? Summary, IReadOnlyList<string>? Tags);

    private sealed record UpdateBookmarkRequest(string Url, string Title, string? Summary, IReadOnlyList<string>? Tags);

    private sealed record SyncBookmarkCollectionsRequest(IReadOnlyList<Guid> CollectionIds);

    /// <summary>
    /// Returns one page of bookmarks using the API's server-side search and paging.
    /// </summary>
    public async Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(string? searchTerm, CancellationToken cancellationToken)
    {
        var requestUri = string.IsNullOrWhiteSpace(searchTerm)
            ? $"api/bookmarks?page=1&pageSize={ListPageSize}"
            : $"api/bookmarks?search={Uri.EscapeDataString(searchTerm.Trim())}&page=1&pageSize={ListPageSize}";

        using var response = await httpClient.GetAsync(requestUri, cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkListResponse>(cancellationToken: cancellationToken)
            ?? new BookmarkListResponse([], 0, 1, ListPageSize);

        return payload.Items
            .Select(item => new BookmarkListItem(
                item.Id,
                item.Url,
                item.Title,
                item.Summary,
                item.UpdatedAtUtc,
                null,
                item.CollectionIds,
                item.Tags))
            .ToList();
    }

    /// <summary>
    /// Returns total and unassigned bookmark counters for dashboard surfaces.
    /// </summary>
    public async Task<(int TotalCount, int UnassignedCount)> GetStatsAsync(CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync("api/bookmarks/stats", cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkStatsResponse>(cancellationToken: cancellationToken)
            ?? new BookmarkStatsResponse(0, 0);

        return (payload.TotalCount, payload.UnassignedCount);
    }

    /// <summary>
    /// Returns one bookmark detail projection or null when not found.
    /// </summary>
    public async Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync($"api/bookmarks/{id}", cancellationToken);

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkResponse>(cancellationToken: cancellationToken);
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
            payload.UpdatedAtUtc,
            payload.CollectionIds,
            payload.Tags);
    }

    /// <summary>
    /// Creates a bookmark with tags and collection membership in one workflow.
    /// </summary>
    public async Task<BookmarkDetailItem> CreateBookmarkAsync(
        CreateBookmarkInput input,
        IReadOnlyList<Guid> collectionIds,
        CancellationToken cancellationToken)
    {
        using var createResponse = await httpClient.PostAsJsonAsync(
            "api/bookmarks",
            new CreateBookmarkRequest(input.Url, input.Title, input.Summary, input.Tags ?? []),
            cancellationToken);
        createResponse.EnsureSuccessStatusCode();

        var created = await createResponse.Content.ReadFromJsonAsync<BookmarkResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bookmark create response payload was empty.");

        if (collectionIds.Count > 0)
        {
            await SyncCollectionsAsync(created.Id, collectionIds, cancellationToken);
        }

        return new BookmarkDetailItem(
            created.Id,
            created.Url,
            created.Title,
            created.Summary,
            created.CreatedAtUtc,
            created.UpdatedAtUtc,
            created.CollectionIds,
            created.Tags);
    }

    /// <summary>
    /// Updates a bookmark's fields and tags, then synchronizes collection membership.
    /// </summary>
    public async Task<BookmarkDetailItem> UpdateBookmarkAsync(
        UpdateBookmarkInput input,
        IReadOnlyList<Guid> collectionIds,
        CancellationToken cancellationToken)
    {
        using var updateResponse = await httpClient.PutAsJsonAsync(
            $"api/bookmarks/{input.Id}",
            new UpdateBookmarkRequest(input.Url, input.Title, input.Summary, input.Tags ?? []),
            cancellationToken);
        updateResponse.EnsureSuccessStatusCode();

        var updated = await updateResponse.Content.ReadFromJsonAsync<BookmarkResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bookmark update response payload was empty.");

        await SyncCollectionsAsync(updated.Id, collectionIds, cancellationToken);

        return new BookmarkDetailItem(
            updated.Id,
            updated.Url,
            updated.Title,
            updated.Summary,
            updated.CreatedAtUtc,
            updated.UpdatedAtUtc,
            updated.CollectionIds,
            updated.Tags);
    }

    /// <summary>
    /// Synchronizes bookmark collection membership to the supplied exact collection set.
    /// </summary>
    public async Task SyncCollectionsAsync(Guid bookmarkId, IReadOnlyList<Guid> collectionIds, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PutAsJsonAsync(
            $"api/bookmarks/{bookmarkId}/collections",
            new SyncBookmarkCollectionsRequest(collectionIds),
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Deletes a bookmark; returns whether a record was removed.
    /// </summary>
    public async Task<bool> DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken)
    {
        using var response = await httpClient.DeleteAsync($"api/bookmarks/{id}", cancellationToken);

        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return false;
        }

        response.EnsureSuccessStatusCode();
        return true;
    }
}
