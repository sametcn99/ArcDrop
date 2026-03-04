using System.Net.Http.Json;
using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Maui.Services;

/// <summary>
/// Executes bookmark update commands against ArcDrop API.
/// </summary>
public sealed class ApiBookmarkCommandService : IBookmarkCommandService
{
    private readonly HttpClient _httpClient;

    public ApiBookmarkCommandService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem> CreateBookmarkAsync(CreateBookmarkInput input, CancellationToken cancellationToken)
    {
        var request = new CreateBookmarkRequest(input.Url, input.Title, input.Summary);
        using var response = await _httpClient.PostAsJsonAsync("api/bookmarks", request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bookmark create response payload was empty.");

        return new BookmarkDetailItem(
            payload.Id,
            payload.Url,
            payload.Title,
            payload.Summary,
            payload.CreatedAtUtc,
            payload.UpdatedAtUtc);
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem> UpdateBookmarkAsync(UpdateBookmarkInput input, CancellationToken cancellationToken)
    {
        var request = new UpdateBookmarkRequest(input.Url, input.Title, input.Summary);
        using var response = await _httpClient.PutAsJsonAsync($"api/bookmarks/{input.Id}", request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bookmark update response payload was empty.");

        return new BookmarkDetailItem(
            payload.Id,
            payload.Url,
            payload.Title,
            payload.Summary,
            payload.CreatedAtUtc,
            payload.UpdatedAtUtc);
    }

    private sealed record CreateBookmarkRequest(string Url, string Title, string? Summary);

    private sealed record UpdateBookmarkRequest(string Url, string Title, string? Summary);

    private sealed record BookmarkResponse(
        Guid Id,
        string Url,
        string Title,
        string? Summary,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset UpdatedAtUtc);
}
