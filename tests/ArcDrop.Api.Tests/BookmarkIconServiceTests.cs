using System.Net;
using System.Text;
using ArcDrop.Web.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Covers bookmark icon discovery and caching rules for the Blazor bookmark board.
/// These tests protect the new card icon workflow against regressions in both success and failure paths.
/// </summary>
public sealed class BookmarkIconServiceTests
{
    /// <summary>
    /// Verifies that a page-provided icon is returned and then reused from cache for the same site origin.
    /// This keeps repeated card renders from re-fetching the same remote assets.
    /// </summary>
    [Fact]
    public async Task GetIconAsync_WhenPageContainsSameOriginIcon_ReturnsImageAndCachesByOrigin()
    {
        var pageHtml = "<html><head><link rel=\"icon\" href=\"/favicon-32x32.png\"></head><body></body></html>";
        var iconBytes = Encoding.UTF8.GetBytes("fake-png-content");
        using var handler = new StubHttpMessageHandler(request => request.RequestUri!.AbsoluteUri switch
        {
            "https://example.com/posts/1" => CreateResponse(HttpStatusCode.OK, pageHtml, "text/html; charset=utf-8"),
            "https://example.com/favicon-32x32.png" => CreateResponse(HttpStatusCode.OK, iconBytes, "image/png"),
            _ => CreateResponse(HttpStatusCode.NotFound)
        });

        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1024 * 1024 });
        var service = new BookmarkIconService(client, cache, NullLogger<BookmarkIconService>.Instance);

        var firstResult = await service.GetIconAsync("https://example.com/posts/1", CancellationToken.None);
        var secondResult = await service.GetIconAsync("https://example.com/posts/2", CancellationToken.None);

        Assert.NotNull(firstResult);
        Assert.Equal("image/png", firstResult!.ContentType);
        Assert.Equal(iconBytes, firstResult.Content);

        Assert.NotNull(secondResult);
        Assert.Equal(iconBytes, secondResult!.Content);

        Assert.Equal(
            [
                "https://example.com/posts/1",
                "https://example.com/favicon-32x32.png"
            ],
            handler.RequestUris);
    }

    /// <summary>
    /// Verifies that missing icon lookups are cached as misses so repeated renders do not hammer the same origin.
    /// This protects the UI from unnecessary latency when sites do not expose a usable favicon.
    /// </summary>
    [Fact]
    public async Task GetIconAsync_WhenSiteHasNoIcon_ReturnsNullAndCachesMiss()
    {
        const string pageHtml = "<html><head><title>No icon</title></head><body></body></html>";
        using var handler = new StubHttpMessageHandler(request => request.RequestUri!.AbsoluteUri switch
        {
            "https://example.com/posts/1" => CreateResponse(HttpStatusCode.OK, pageHtml, "text/html; charset=utf-8"),
            "https://example.com/favicon.ico" => CreateResponse(HttpStatusCode.NotFound),
            "https://example.com/apple-touch-icon.png" => CreateResponse(HttpStatusCode.NotFound),
            _ => CreateResponse(HttpStatusCode.NotFound)
        });

        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1024 * 1024 });
        var service = new BookmarkIconService(client, cache, NullLogger<BookmarkIconService>.Instance);

        var firstResult = await service.GetIconAsync("https://example.com/posts/1", CancellationToken.None);
        var secondResult = await service.GetIconAsync("https://example.com/posts/2", CancellationToken.None);

        Assert.Null(firstResult);
        Assert.Null(secondResult);
        Assert.Equal(
            [
                "https://example.com/posts/1",
                "https://example.com/favicon.ico",
                "https://example.com/apple-touch-icon.png"
            ],
            handler.RequestUris);
    }

    /// <summary>
    /// Verifies that extensionless icon endpoints served as octet-stream are normalized to a renderable
    /// image type so bookmark cards can display the fetched favicon instead of falling back to initials.
    /// </summary>
    [Fact]
    public async Task GetIconAsync_WhenIconUsesOctetStreamWithoutExtension_SniffsActualIconType()
    {
        const string pageHtml = "<html><head><link rel=\"icon\" href=\"/assets/icon\"></head><body></body></html>";
        byte[] iconBytes = [0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10];

        using var handler = new StubHttpMessageHandler(request => request.RequestUri!.AbsoluteUri switch
        {
            "https://example.com/posts/1" => CreateResponse(HttpStatusCode.OK, pageHtml, "text/html; charset=utf-8"),
            "https://example.com/assets/icon" => CreateResponse(HttpStatusCode.OK, iconBytes, "application/octet-stream"),
            _ => CreateResponse(HttpStatusCode.NotFound)
        });

        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1024 * 1024 });
        var service = new BookmarkIconService(client, cache, NullLogger<BookmarkIconService>.Instance);

        var result = await service.GetIconAsync("https://example.com/posts/1", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("image/x-icon", result!.ContentType);
        Assert.Equal(iconBytes, result.Content);
    }

    private static HttpResponseMessage CreateResponse(HttpStatusCode statusCode, string content, string? contentType = null)
    {
        return CreateResponse(statusCode, Encoding.UTF8.GetBytes(content), contentType);
    }

    private static HttpResponseMessage CreateResponse(HttpStatusCode statusCode, byte[]? content = null, string? contentType = null)
    {
        var response = new HttpResponseMessage(statusCode);
        if (content is not null)
        {
            response.Content = new ByteArrayContent(content);
            if (!string.IsNullOrWhiteSpace(contentType))
            {
                response.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
            }
        }

        return response;
    }

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responseFactory;

        public StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
        {
            _responseFactory = responseFactory;
        }

        public List<string> RequestUris { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri!.AbsoluteUri);
            return Task.FromResult(_responseFactory(request));
        }
    }
}