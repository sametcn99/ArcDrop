using System.Net;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Web.Services;

/// <summary>
/// Fetches and caches website icons so bookmark cards can render a stable visual identity
/// without repeatedly reaching out to the same origin.
/// </summary>
public sealed partial class BookmarkIconService : IBookmarkIconService
{
    private static readonly TimeSpan IconCacheDuration = TimeSpan.FromHours(12);
    private static readonly TimeSpan MissingIconCacheDuration = TimeSpan.FromMinutes(30);
    private const int MaximumIconBytes = 256 * 1024;

    private readonly HttpClient _httpClient;
    private readonly IMemoryCache _cache;
    private readonly ILogger<BookmarkIconService> _logger;

    public BookmarkIconService(
        HttpClient httpClient,
        IMemoryCache cache,
        ILogger<BookmarkIconService> logger)
    {
        _httpClient = httpClient;
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<BookmarkIconPayload?> GetIconAsync(string bookmarkUrl, CancellationToken cancellationToken)
    {
        var bookmarkUri = NormalizeBookmarkUri(bookmarkUrl);
        if (bookmarkUri is null)
        {
            return null;
        }

        var cacheKey = BuildCacheKey(bookmarkUri);
        if (_cache.TryGetValue<BookmarkIconCacheEntry>(cacheKey, out var cachedEntry))
        {
            return cachedEntry?.ToPayload();
        }

        var resolvedEntry = await ResolveIconAsync(bookmarkUri, cancellationToken);
        _cache.Set(
            cacheKey,
            resolvedEntry,
            new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = resolvedEntry.HasContent ? IconCacheDuration : MissingIconCacheDuration,
                Size = resolvedEntry.CacheSize
            });

        return resolvedEntry.ToPayload();
    }

    private async Task<BookmarkIconCacheEntry> ResolveIconAsync(Uri bookmarkUri, CancellationToken cancellationToken)
    {
        var origin = new Uri(bookmarkUri.GetLeftPart(UriPartial.Authority), UriKind.Absolute);
        var candidateUris = new List<Uri>();

        // Page-level discovery lets the app honor custom icon paths before falling back to root assets.
        try
        {
            using var documentResponse = await SendFollowingSameOriginRedirectsAsync(bookmarkUri, "text/html", cancellationToken);
            if (documentResponse?.IsSuccessStatusCode == true && IsHtmlResponse(documentResponse))
            {
                var html = await documentResponse.Content.ReadAsStringAsync(cancellationToken);
                candidateUris.AddRange(ExtractIconUris(html, bookmarkUri, origin));
            }
        }
        catch (HttpRequestException exception)
        {
            // Icon discovery failures should not break bookmark rendering, but they should remain diagnosable.
            _logger.LogWarning(exception, "Bookmark icon document fetch failed for {BookmarkUrl}", bookmarkUri);
        }
        catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning(exception, "Bookmark icon document fetch timed out for {BookmarkUrl}", bookmarkUri);
        }

        candidateUris.Add(new Uri(origin, "/favicon.ico"));
        candidateUris.Add(new Uri(origin, "/apple-touch-icon.png"));

        foreach (var candidateUri in candidateUris.Distinct())
        {
            try
            {
                using var iconResponse = await SendFollowingSameOriginRedirectsAsync(candidateUri, "image/*", cancellationToken);
                if (iconResponse?.IsSuccessStatusCode != true)
                {
                    continue;
                }

                var contentType = iconResponse.Content.Headers.ContentType?.MediaType;
                if (!IsSupportedIconContentType(contentType, candidateUri))
                {
                    continue;
                }

                var content = await iconResponse.Content.ReadAsByteArrayAsync(cancellationToken);
                if (content.Length == 0 || content.Length > MaximumIconBytes)
                {
                    continue;
                }

                // Some sites serve favicon bytes from extensionless URLs or as octet-stream, so the
                // response type must be normalized from the actual payload before the browser can render it.
                var resolvedContentType = ResolveContentType(contentType, candidateUri, content);
                if (string.IsNullOrWhiteSpace(resolvedContentType))
                {
                    continue;
                }

                return BookmarkIconCacheEntry.WithContent(content, resolvedContentType);
            }
            catch (HttpRequestException exception)
            {
                _logger.LogDebug(exception, "Bookmark icon download failed for {IconUrl}", candidateUri);
            }
            catch (TaskCanceledException exception) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogDebug(exception, "Bookmark icon download timed out for {IconUrl}", candidateUri);
            }
        }

        return BookmarkIconCacheEntry.Missing;
    }

    private async Task<HttpResponseMessage?> SendFollowingSameOriginRedirectsAsync(
        Uri requestUri,
        string acceptMediaType,
        CancellationToken cancellationToken)
    {
        var currentUri = requestUri;
        var origin = currentUri.GetLeftPart(UriPartial.Authority);

        // Only same-origin redirects are followed so icon discovery cannot pivot to an arbitrary host.
        for (var redirectCount = 0; redirectCount < 3; redirectCount++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(acceptMediaType));

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
            if (!IsAllowedRedirect(redirectedUri, origin))
            {
                return null;
            }

            currentUri = redirectedUri;
        }

        return null;
    }

    private static IEnumerable<Uri> ExtractIconUris(string html, Uri documentUri, Uri origin)
    {
        foreach (Match linkMatch in LinkTagExpression().Matches(html))
        {
            var attributes = ParseAttributes(linkMatch.Value);
            if (!attributes.TryGetValue("rel", out var relValue) || !LooksLikeIconRelation(relValue))
            {
                continue;
            }

            if (!attributes.TryGetValue("href", out var hrefValue) || string.IsNullOrWhiteSpace(hrefValue))
            {
                continue;
            }

            var decodedHref = WebUtility.HtmlDecode(hrefValue.Trim());
            if (TryResolveSameOriginUri(documentUri, origin, decodedHref, out var iconUri))
            {
                yield return iconUri;
            }
        }
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

    private static bool TryResolveSameOriginUri(Uri documentUri, Uri origin, string href, out Uri resolvedUri)
    {
        resolvedUri = default!;
        if (href.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var candidateUri = Uri.TryCreate(href, UriKind.Absolute, out var absoluteUri)
            ? absoluteUri
            : new Uri(documentUri, href);

        if (!IsAllowedRedirect(candidateUri, origin.GetLeftPart(UriPartial.Authority)))
        {
            return false;
        }

        resolvedUri = candidateUri;
        return true;
    }

    private static bool IsAllowedRedirect(Uri candidateUri, string origin)
    {
        return (string.Equals(candidateUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            && string.Equals(candidateUri.GetLeftPart(UriPartial.Authority), origin, StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikeIconRelation(string relValue)
    {
        return relValue.Contains("icon", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsHtmlResponse(HttpResponseMessage response)
    {
        return response.Content.Headers.ContentType?.MediaType?.Contains("html", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static bool IsSupportedIconContentType(string? contentType, Uri iconUri)
    {
        if (string.IsNullOrWhiteSpace(contentType))
        {
            return true;
        }

        return contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
            || string.Equals(contentType, "application/octet-stream", StringComparison.OrdinalIgnoreCase)
            || !string.IsNullOrWhiteSpace(InferContentType(iconUri));
    }

    private static string? ResolveContentType(string? contentType, Uri iconUri, byte[] content)
    {
        if (!string.IsNullOrWhiteSpace(contentType)
            && contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        {
            return contentType;
        }

        // Byte-signature sniffing keeps icons renderable when remote hosts omit a trustworthy media type.
        if (LooksLikePng(content))
        {
            return "image/png";
        }

        if (LooksLikeJpeg(content))
        {
            return "image/jpeg";
        }

        if (LooksLikeGif(content))
        {
            return "image/gif";
        }

        if (LooksLikeIco(content))
        {
            return "image/x-icon";
        }

        if (LooksLikeSvg(content))
        {
            return "image/svg+xml";
        }

        return InferContentType(iconUri);
    }

    private static string? InferContentType(Uri iconUri)
    {
        return Path.GetExtension(iconUri.AbsolutePath).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".svg" => "image/svg+xml",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".ico" => "image/x-icon",
            _ => null
        };
    }

    private static bool LooksLikePng(byte[] content)
    {
        return content.Length >= 8
            && content[0] == 0x89
            && content[1] == 0x50
            && content[2] == 0x4E
            && content[3] == 0x47
            && content[4] == 0x0D
            && content[5] == 0x0A
            && content[6] == 0x1A
            && content[7] == 0x0A;
    }

    private static bool LooksLikeJpeg(byte[] content)
    {
        return content.Length >= 3
            && content[0] == 0xFF
            && content[1] == 0xD8
            && content[2] == 0xFF;
    }

    private static bool LooksLikeGif(byte[] content)
    {
        return content.Length >= 6
            && content[0] == 0x47
            && content[1] == 0x49
            && content[2] == 0x46
            && content[3] == 0x38
            && (content[4] == 0x37 || content[4] == 0x39)
            && content[5] == 0x61;
    }

    private static bool LooksLikeIco(byte[] content)
    {
        return content.Length >= 4
            && content[0] == 0x00
            && content[1] == 0x00
            && content[2] == 0x01
            && content[3] == 0x00;
    }

    private static bool LooksLikeSvg(byte[] content)
    {
        var probeLength = Math.Min(content.Length, 512);
        var probeText = System.Text.Encoding.UTF8.GetString(content, 0, probeLength).TrimStart('\uFEFF', ' ', '\t', '\r', '\n');
        return probeText.StartsWith("<svg", StringComparison.OrdinalIgnoreCase)
            || probeText.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase)
            || probeText.Contains("<svg", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsRedirect(HttpStatusCode statusCode)
    {
        return statusCode is HttpStatusCode.Moved or HttpStatusCode.Redirect or HttpStatusCode.RedirectMethod
            or HttpStatusCode.RedirectKeepVerb or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;
    }

    private static Uri? NormalizeBookmarkUri(string bookmarkUrl)
    {
        return Uri.TryCreate(bookmarkUrl, UriKind.Absolute, out var bookmarkUri)
            && (string.Equals(bookmarkUri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
                || string.Equals(bookmarkUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            ? bookmarkUri
            : null;
    }

    private static string BuildCacheKey(Uri bookmarkUri)
    {
        return $"bookmark-icon::{bookmarkUri.GetLeftPart(UriPartial.Authority).ToLowerInvariant()}";
    }

    [GeneratedRegex("<link\\b[^>]*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex LinkTagExpression();

    [GeneratedRegex("(?<name>[a-zA-Z_:][-a-zA-Z0-9_:.]*)\\s*=\\s*(?:\"(?<value>[^\"]*)\"|'(?<value>[^']*)'|(?<value>[^\\s>]+))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AttributeExpression();

    private sealed record BookmarkIconCacheEntry(byte[]? Content, string? ContentType)
    {
        public static BookmarkIconCacheEntry Missing { get; } = new(null, null);

        public bool HasContent => Content is { Length: > 0 } && !string.IsNullOrWhiteSpace(ContentType);

        public int CacheSize => Math.Max(Content?.Length ?? 1, 1);

        public BookmarkIconPayload? ToPayload()
        {
            return HasContent ? new BookmarkIconPayload(Content!, ContentType!) : null;
        }

        public static BookmarkIconCacheEntry WithContent(byte[] content, string contentType)
        {
            return new BookmarkIconCacheEntry(content, contentType);
        }
    }
}