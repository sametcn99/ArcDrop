using System.Net;
using System.Net.Http.Json;

namespace ArcDrop.Web.Services;

/// <summary>
/// Implements web bookmark operations by calling ArcDrop API endpoints.
/// </summary>
public sealed class BookmarkWebService : IBookmarkWebService
{
    private readonly HttpClient _httpClient;

    public BookmarkWebService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<BookmarkDto>> GetBookmarksAsync(CancellationToken cancellationToken)
    {
        var payload = await _httpClient.GetFromJsonAsync<List<BookmarkDto>>("api/bookmarks", cancellationToken)
            ?? [];

        return payload;
    }

    /// <inheritdoc />
    public async Task<BookmarkDto?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.GetAsync($"api/bookmarks/{id}", cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BookmarkDto> CreateBookmarkAsync(CreateBookmarkRequest request, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.PostAsJsonAsync("api/bookmarks", request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bookmark create response was empty.");

        return payload;
    }

    /// <inheritdoc />
    public async Task<BookmarkDto> UpdateBookmarkAsync(Guid id, UpdateBookmarkRequest request, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.PutAsJsonAsync($"api/bookmarks/{id}", request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkDto>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Bookmark update response was empty.");

        return payload;
    }
}
