using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ArcDrop.Api.Contracts;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Validates fixed-admin password rotation behavior and policy enforcement.
/// Tests use isolated application factories to avoid shared credential state between scenarios.
/// </summary>
public sealed class AdminCredentialRotationTests
{
    /// <summary>
    /// Verifies that valid current credentials can rotate password and that login reflects the new value.
    /// </summary>
    [Fact]
    public async Task RotatePassword_WithValidCurrentPassword_UpdatesLoginCredentials()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var initialLogin = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "ChangeThisDevelopmentPassword"));
        Assert.Equal(HttpStatusCode.OK, initialLogin.StatusCode);

        var tokenPayload = await initialLogin.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(tokenPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenPayload!.AccessToken);

        var rotateResponse = await client.PostAsJsonAsync("/api/auth/rotate-password", new RotateAdminPasswordRequest(
            "ChangeThisDevelopmentPassword",
            "NewDevelopmentPassword!123"));
        Assert.Equal(HttpStatusCode.NoContent, rotateResponse.StatusCode);

        client.DefaultRequestHeaders.Authorization = null;

        var oldLogin = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "ChangeThisDevelopmentPassword"));
        Assert.Equal(HttpStatusCode.Unauthorized, oldLogin.StatusCode);

        var newLogin = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "NewDevelopmentPassword!123"));
        Assert.Equal(HttpStatusCode.OK, newLogin.StatusCode);
    }

    /// <summary>
    /// Verifies that rotation is rejected when current password proof is invalid.
    /// </summary>
    [Fact]
    public async Task RotatePassword_WithInvalidCurrentPassword_ReturnsUnauthorized()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var initialLogin = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "ChangeThisDevelopmentPassword"));
        Assert.Equal(HttpStatusCode.OK, initialLogin.StatusCode);

        var tokenPayload = await initialLogin.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(tokenPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenPayload!.AccessToken);

        var rotateResponse = await client.PostAsJsonAsync("/api/auth/rotate-password", new RotateAdminPasswordRequest(
            "WrongCurrentPassword!123",
            "AnotherStrongPassword!123"));

        Assert.Equal(HttpStatusCode.Unauthorized, rotateResponse.StatusCode);
    }

    /// <summary>
    /// Verifies that policy checks reject weak replacement passwords.
    /// </summary>
    [Fact]
    public async Task RotatePassword_WithWeakPassword_ReturnsValidationProblem()
    {
        using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var initialLogin = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-dev",
            "ChangeThisDevelopmentPassword"));
        Assert.Equal(HttpStatusCode.OK, initialLogin.StatusCode);

        var tokenPayload = await initialLogin.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(tokenPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", tokenPayload!.AccessToken);

        var rotateResponse = await client.PostAsJsonAsync("/api/auth/rotate-password", new RotateAdminPasswordRequest(
            "ChangeThisDevelopmentPassword",
            "weak"));

        Assert.Equal(HttpStatusCode.BadRequest, rotateResponse.StatusCode);
    }
}
