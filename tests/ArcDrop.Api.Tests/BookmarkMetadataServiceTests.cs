using System.Net;
using System.Text;
using ArcDrop.Web.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Covers URL metadata extraction and caching behavior used by create/edit bookmark forms.
/// </summary>
public sealed class BookmarkMetadataServiceTests
{
    /// <summary>
    /// Verifies title and description extraction from a normal HTML page response.
    /// </summary>
    [Fact]
    public async Task GetMetadataAsync_WhenHtmlContainsTitleAndDescription_ReturnsMetadata()
    {
        const string html = "<html><head><title> ArcDrop Docs </title><meta name=\"description\" content=\" Self-host quickstart guide \" /></head><body></body></html>";

        using var handler = new StubHttpMessageHandler(request => request.RequestUri!.AbsoluteUri switch
        {
            "https://docs.example.com/quickstart" => CreateResponse(HttpStatusCode.OK, html, "text/html; charset=utf-8"),
            _ => CreateResponse(HttpStatusCode.NotFound)
        });

        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1024 * 1024 });
        var service = new BookmarkMetadataService(client, cache, NullLogger<BookmarkMetadataService>.Instance);

        var result = await service.GetMetadataAsync("https://docs.example.com/quickstart", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("ArcDrop Docs", result!.Title);
        Assert.Equal("Self-host quickstart guide", result.Description);
    }

    /// <summary>
    /// Verifies metadata lookups are cached by URL so repeated suggestions avoid another network round-trip.
    /// </summary>
    [Fact]
    public async Task GetMetadataAsync_WhenCalledTwiceForSameUrl_UsesCache()
    {
        const string html = "<html><head><title>Cached Title</title></head></html>";

        using var handler = new StubHttpMessageHandler(request => request.RequestUri!.AbsoluteUri switch
        {
            "https://example.com/a" => CreateResponse(HttpStatusCode.OK, html, "text/html; charset=utf-8"),
            _ => CreateResponse(HttpStatusCode.NotFound)
        });

        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(5) };
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1024 * 1024 });
        var service = new BookmarkMetadataService(client, cache, NullLogger<BookmarkMetadataService>.Instance);

        var firstResult = await service.GetMetadataAsync("https://example.com/a", CancellationToken.None);
        var secondResult = await service.GetMetadataAsync("https://example.com/a#section", CancellationToken.None);

        Assert.NotNull(firstResult);
        Assert.NotNull(secondResult);
        Assert.Equal("Cached Title", secondResult!.Title);
        Assert.Single(handler.RequestUris);
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
