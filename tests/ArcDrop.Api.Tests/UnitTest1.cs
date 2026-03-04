using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
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
    /// Verifies that fixed-admin credentials from startup configuration can obtain a JWT token.
    /// This protects the initial login contract from accidental regressions.
    /// </summary>
    [Fact]
    public async Task Login_WithValidCredentials_ReturnsAccessToken()
    {
        var response = await _httpClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "ChangeThisDevelopmentPassword"));

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
        var response = await _httpClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "wrong-password"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// Verifies that authenticated requests can access the admin profile endpoint.
    /// </summary>
    [Fact]
    public async Task Me_Endpoint_WithBearerToken_ReturnsAuthenticatedProfile()
    {
        var loginResponse = await _httpClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "ChangeThisDevelopmentPassword"));

        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);

        var tokenPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(tokenPayload);

        _httpClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenPayload!.AccessToken);

        var meResponse = await _httpClient.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);

        var mePayload = await meResponse.Content.ReadFromJsonAsync<CurrentAdminResponse>();
        Assert.NotNull(mePayload);
        Assert.True(mePayload!.Authenticated);
        Assert.Equal("admin-dev", mePayload.Username);
    }
}
