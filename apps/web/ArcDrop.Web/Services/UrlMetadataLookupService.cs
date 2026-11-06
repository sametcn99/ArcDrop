using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Components;

namespace ArcDrop.Web.Services;

/// <summary>
/// Represents a URL metadata suggestion fetched from the local metadata endpoint.
/// </summary>
public sealed record UrlMetadataSuggestion(string Title, string? Description);

/// <summary>
/// Fetches URL metadata suggestions so bookmark dialogs share one lookup implementation.
/// </summary>
public interface IUrlMetadataLookup
{
    /// <summary>
    /// Returns a metadata suggestion for the supplied URL, or null when nothing useful was found.
    /// </summary>
    Task<UrlMetadataSuggestion?> LookupAsync(string url, CancellationToken cancellationToken);
}

/// <summary>
/// Implements URL metadata lookups against the app-local metadata proxy endpoint.
/// </summary>
public sealed class UrlMetadataLookupService(HttpClient httpClient, NavigationManager navigationManager) : IUrlMetadataLookup
{
    private sealed record BookmarkMetadataResponse(string Title, string? Description);

    /// <inheritdoc />
    public async Task<UrlMetadataSuggestion?> LookupAsync(string url, CancellationToken cancellationToken)
    {
        var normalizedUrl = url.Trim();
        if (string.IsNullOrWhiteSpace(normalizedUrl))
        {
            return null;
        }

        var requestUri = new Uri($"{navigationManager.BaseUri}bookmark-metadata?url={Uri.EscapeDataString(normalizedUrl)}");
        using var response = await httpClient.GetAsync(requestUri, cancellationToken);

        if (response.StatusCode == HttpStatusCode.NoContent)
        {
            return null;
        }

        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<BookmarkMetadataResponse>(cancellationToken: cancellationToken);
        return payload is null
            ? null
            : new UrlMetadataSuggestion(payload.Title, payload.Description);
    }
}
