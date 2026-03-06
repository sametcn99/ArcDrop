using System.Net;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Web.Services;

/// <summary>
/// Fetches and caches bookmark metadata so title and summary suggestions can be offered
/// immediately while users type URLs in create and edit forms.
/// </summary>
public sealed partial class BookmarkMetadataService : IBookmarkMetadataService
{
    private static readonly TimeSpan MetadataCacheDuration = TimeSpan.FromHours(6);
    private static readonly TimeSpan MissingMetadataCacheDuration = TimeSpan.FromMinutes(20);
    private const int MaximumDocumentBytes = 512 * 1024;

    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private readonly ILogger<BookmarkMetadataService> _logger;

    public BookmarkMetadataService(
        HttpClient httpClient,
        IMemoryCache cache,
        ILogger<BookmarkMetadataService> logger)
    {
        _httpClient = httpClient;
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<BookmarkMetadataPayload?> GetMetadataAsync(string bookmarkUrl, CancellationToken cancellationToken)
    {
        var bookmarkUri = NormalizeBookmarkUri(bookmarkUrl);
        if (bookmarkUri is null)
        {
            return null;
        }

        var cacheKey = BuildCacheKey(bookmarkUri);
        if (_cache.TryGetValue<BookmarkMetadataCacheEntry>(cacheKey, out var cachedEntry))
        {
            return cachedEntry?.ToPayload();
        }

        var resolvedEntry = await ResolveMetadataAsync(bookmarkUri, cancellationToken);
        _cache.Set(
            cacheKey,
            resolvedEntry,
            new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = resolvedEntry.HasContent ? MetadataCacheDuration : MissingMetadataCacheDuration,
                Size = resolvedEntry.CacheSize
            });

        return resolvedEntry.ToPayload();
    }

    private async Task<BookmarkMetadataCacheEntry> ResolveMetadataAsync(Uri bookmarkUri, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await SendFollowingRedirectsAsync(bookmarkUri, cancellationToken);
            if (response?.IsSuccessStatusCode != true || !IsHtmlResponse(response))
            {
                return BookmarkMetadataCacheEntry.Missing;
            }

            var payload = await ReadAsBoundedByteArrayAsync(response.Content, cancellationToken);
            if (payload.Length == 0)
            {
                return BookmarkMetadataCacheEntry.Missing;
            }

            var html = DecodeHtml(payload, response.Content.Headers.ContentType?.CharSet);
            var title = TryExtractTitle(html);
            var description = TryExtractDescription(html);

            if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(description))
            {
                return BookmarkMetadataCacheEntry.Missing;
            }

            var resolvedTitle = string.IsNullOrWhiteSpace(title)
                ? bookmarkUri.Host
                : title!;

            return BookmarkMetadataCacheEntry.WithContent(resolvedTitle, description);
        }
        catch (HttpRequestException exception)
        {
            // Metadata failures should not block manual data entry, but should stay visible in diagnostics.
            _logger.LogDebug(exception, "Bookmark metadata fetch failed for {BookmarkUrl}", bookmarkUri);
            return BookmarkMetadataCacheEntry.Missing;
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogDebug(exception, "Bookmark metadata fetch timed out for {BookmarkUrl}", bookmarkUri);
            return BookmarkMetadataCacheEntry.Missing;
        }
    }

    private async Task<HttpResponseMessage?> SendFollowingRedirectsAsync(Uri requestUri, CancellationToken cancellationToken)
    {
        var currentUri = requestUri;

        // Redirect handling is explicit so timeout, host, and scheme checks remain deterministic.
        for (var redirectCount = 0; redirectCount < 3; redirectCount++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/html"));

            var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!IsRedirect(response.StatusCode))
            {
                return response;
            }

            var location = response.Headers.Location;
            response.Dispose();
            if (location is null)
            {
                return null;
            }

            var redirectedUri = location.IsAbsoluteUri ? location : new Uri(currentUri, location);
            if (!IsSupportedHttpScheme(redirectedUri))
            {
                return null;
            }

            currentUri = redirectedUri;
        }

        return null;
    }

    private static async Task<byte[]> ReadAsBoundedByteArrayAsync(HttpContent content, CancellationToken cancellationToken)
    {
        using var sourceStream = await content.ReadAsStreamAsync(cancellationToken);
        using var boundedStream = new MemoryStream();
        var buffer = new byte[16 * 1024];
        var totalRead = 0;

        while (true)
        {
            var read = await sourceStream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (read == 0)
            {
                break;
            }

            totalRead += read;
            if (totalRead > MaximumDocumentBytes)
            {
                return [];
            }

            await boundedStream.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        return boundedStream.ToArray();
    }

    private static string DecodeHtml(byte[] payload, string? charset)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(charset))
            {
                var encoding = System.Text.Encoding.GetEncoding(charset);
                return encoding.GetString(payload);
            }
        }
        catch (ArgumentException)
        {
            // Unknown charsets gracefully fall back to UTF-8.
        }

        return System.Text.Encoding.UTF8.GetString(payload);
    }

    private static string? TryExtractTitle(string html)
    {
        var titleMatch = TitleExpression().Match(html);
        if (!titleMatch.Success)
        {
            return null;
        }

        return NormalizeText(WebUtility.HtmlDecode(titleMatch.Groups["value"].Value));
    }

    private static string? TryExtractDescription(string html)
    {
        string? candidate = null;

        foreach (Match metaMatch in MetaTagExpression().Matches(html))
        {
            var attributes = ParseAttributes(metaMatch.Value);
            if (!attributes.TryGetValue("content", out var content) || string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            if (attributes.TryGetValue("name", out var name)
                && string.Equals(name.Trim(), "description", StringComparison.OrdinalIgnoreCase))
            {
                candidate = content;
                break;
            }

            if (attributes.TryGetValue("property", out var property)
                && (string.Equals(property.Trim(), "og:description", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(property.Trim(), "twitter:description", StringComparison.OrdinalIgnoreCase)))
            {
                candidate = content;
                break;
            }
        }

        return string.IsNullOrWhiteSpace(candidate)
            ? null
            : NormalizeText(WebUtility.HtmlDecode(candidate));
    }

    private static Dictionary<string, string> ParseAttributes(string tag)
    {
        var attributes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match attributeMatch in AttributeExpression().Matches(tag))
        {
            attributes[attributeMatch.Groups["name"].Value] = attributeMatch.Groups["value"].Value;
        }

        return attributes;
    }

    private static string? NormalizeText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = WhiteSpaceExpression().Replace(value, " ").Trim();
        return normalized.Length == 0 ? null : normalized;
    }

    private static bool IsHtmlResponse(HttpResponseMessage response)
    {
        var mediaType = response.Content.Headers.ContentType?.MediaType;
        return !string.IsNullOrWhiteSpace(mediaType)
            && mediaType.Contains("html", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRedirect(HttpStatusCode statusCode)
    {
        return statusCode is HttpStatusCode.Moved or HttpStatusCode.Redirect or HttpStatusCode.RedirectMethod
            or HttpStatusCode.RedirectKeepVerb or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;
    }

    private static bool IsSupportedHttpScheme(Uri uri)
    {
        return string.Equals(uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            || string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
    }

    private static Uri? NormalizeBookmarkUri(string bookmarkUrl)
    {
        return Uri.TryCreate(bookmarkUrl, UriKind.Absolute, out var bookmarkUri) && IsSupportedHttpScheme(bookmarkUri)
            ? bookmarkUri
            : null;
    }

    private static string BuildCacheKey(Uri bookmarkUri)
    {
        // Metadata is page-specific, so cache key includes the full absolute URL without fragment.
        var withoutFragment = new UriBuilder(bookmarkUri) { Fragment = string.Empty }.Uri.AbsoluteUri;
        return $"bookmark-metadata::{withoutFragment.ToLowerInvariant()}";
    }

    [GeneratedRegex("<title[^>]*>(?<value>.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex TitleExpression();

    [GeneratedRegex("<meta\\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MetaTagExpression();

    [GeneratedRegex("(?<name>[a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*(?:\"(?<value>[^\"]*)\"|'(?<value>[^']*)'|(?<value>[^\\s>]+))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AttributeExpression();

    [GeneratedRegex("\\s+", RegexOptions.CultureInvariant)]
    private static partial Regex WhiteSpaceExpression();

    private sealed record BookmarkMetadataCacheEntry(string? Title, string? Description)
    {
        public static BookmarkMetadataCacheEntry Missing { get; } = new(null, null);

        public bool HasContent => !string.IsNullOrWhiteSpace(Title) || !string.IsNullOrWhiteSpace(Description);

        public int CacheSize => Math.Max((Title?.Length ?? 0) + (Description?.Length ?? 0), 1);

        public BookmarkMetadataPayload? ToPayload()
        {
            if (!HasContent)
            {
                return null;
            }

            var resolvedTitle = string.IsNullOrWhiteSpace(Title) ? "Untitled page" : Title!;
            return new BookmarkMetadataPayload(resolvedTitle, Description);
        }

        public static BookmarkMetadataCacheEntry WithContent(string title, string? description)
        {
            return new BookmarkMetadataCacheEntry(title, description);
        }
    }
}
