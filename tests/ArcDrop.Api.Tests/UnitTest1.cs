using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ArcDrop.Api.Contracts;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Provides startup smoke tests that validate the initial self-host API scaffold.
/// These tests are intentionally lightweight and focus on contract availability
/// so TASK-002 can prove boot readiness before deeper feature work begins.
/// </summary>
public sealed class StartupSmokeTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _httpClient;

    /// <summary>
    /// Creates an HTTP client backed by the in-memory test server.
    /// This avoids network flakiness and keeps startup checks deterministic.
    /// </summary>
    public StartupSmokeTests(WebApplicationFactory<Program> factory)
    {
        _httpClient = factory.CreateClient();
    }

    /// <summary>
    /// Verifies that the API root endpoint responds successfully.
    /// A failure here indicates startup or routing regressions in core bootstrap wiring.
    /// </summary>
    [Fact]
    public async Task Root_Endpoint_ReturnsSuccessStatusCode()
    {
        var response = await _httpClient.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Verifies that the health endpoint is reachable for deployment runbooks
    /// and automated orchestration probes.
    /// </summary>
    [Fact]
    public async Task Health_Endpoint_ReturnsSuccessStatusCode()
    {
        var response = await _httpClient.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Verifies that the runtime-generated OpenAPI document is exposed for tooling and documentation consumers.
    /// This protects the automated API contract export used by Scalar and build-time document generation.
    /// </summary>
    [Fact]
    public async Task OpenApi_DocumentEndpoint_ReturnsGeneratedSpecification()
    {
        var response = await _httpClient.GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;

        Assert.True(root.TryGetProperty("openapi", out _));
        Assert.Equal("ArcDrop API", root.GetProperty("info").GetProperty("title").GetString());

        var loginOperation = root
            .GetProperty("paths")
            .GetProperty("/api/auth/login")
            .GetProperty("post");

        Assert.Equal("LoginAdmin", loginOperation.GetProperty("operationId").GetString());
        Assert.Equal("Authenticates the fixed admin account.", loginOperation.GetProperty("summary").GetString());

        var createBookmarkOperation = root
            .GetProperty("paths")
            .GetProperty("/api/bookmarks")
            .GetProperty("post");

        Assert.Equal("CreateBookmark", createBookmarkOperation.GetProperty("operationId").GetString());
        Assert.True(createBookmarkOperation.GetProperty("responses").TryGetProperty("201", out _));
        Assert.True(createBookmarkOperation.GetProperty("responses").TryGetProperty("400", out _));
    }

    /// <summary>
    /// Verifies that the Scalar reference UI is served from the docs path.
    /// This ensures self-host operators have an interactive API reference without separate tooling.
    /// </summary>
    [Fact]
    public async Task Docs_Endpoint_ReturnsScalarReferenceUi()
    {
        var response = await _httpClient.GetAsync("/docs");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);

        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("ArcDrop API Console", html, StringComparison.Ordinal);
        Assert.Contains("<!doctype html>", html, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Verifies that fixed-admin credentials from startup configuration can obtain a JWT token.
    /// This protects the initial login contract from accidental regressions.
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ReturnsAccessToken()
    {
        using var environment = new TestEnvironmentVariableScope(new Dictionary<string, string?>
        {
            ["ARCDROP_ADMIN_USERNAME"] = "admin-smoke",
            ["ARCDROP_ADMIN_PASSWORD"] = "SmokePassword!123"
        });

        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-smoke",
            "SmokePassword!123"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var payload = await response.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(payload);
        Assert.False(string.IsNullOrWhiteSpace(payload!.AccessToken));
    }

    /// <summary>
    /// Verifies that invalid credentials are rejected with unauthorized status.
    /// </summary>
    [Fact]
    public async Task Login_WithInvalidCredentials_ReturnsUnauthorized()
    {
        using var environment = new TestEnvironmentVariableScope(new Dictionary<string, string?>
        {
            ["ARCDROP_ADMIN_USERNAME"] = "admin-smoke",
            ["ARCDROP_ADMIN_PASSWORD"] = "SmokePassword!123"
        });

        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-smoke",
            "wrong-password"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Verifies that authenticated requests can access the admin profile endpoint.
    /// </summary>
    [Fact]
    public async Task Me_Endpoint_WithBearerToken_ReturnsAuthenticatedProfile()
    {
        using var environment = new TestEnvironmentVariableScope(new Dictionary<string, string?>
        {
            ["ARCDROP_ADMIN_USERNAME"] = "admin-smoke",
            ["ARCDROP_ADMIN_PASSWORD"] = "SmokePassword!123"
        });

        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-smoke",
            "SmokePassword!123"));

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);

        var tokenPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(tokenPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenPayload!.AccessToken);

        var meResponse = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);

        var mePayload = await meResponse.Content.ReadFromJsonAsync<CurrentAdminResponse>();
        Assert.NotNull(mePayload);
        Assert.True(mePayload!.Authenticated);
        Assert.Equal("admin-smoke", mePayload.Username);
    }
}
