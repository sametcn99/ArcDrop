using System.Net;
using System.Net.Http.Json;

namespace ArcDrop.Avalonia.Services;

/// <summary>
/// API-backed fixed-admin authentication for the Linux desktop client.
/// </summary>
public sealed class ApiAuthService(HttpClient httpClient, IApiAuthSession authSession) : IApiAuthService
{
    private sealed record LoginRequest(string Username, string Password);

    private sealed record LoginResponse(string AccessToken, DateTimeOffset ExpiresAtUtc);

    private sealed record CurrentAdminResponse(string Username, bool Authenticated);

    /// <inheritdoc />
    public async Task<string?> LoginAsync(string username, string password, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return "Username and password are required.";
        }

        using var response = await httpClient.PostAsJsonAsync(
            "api/auth/login",
            new LoginRequest(username.Trim(), password),
            cancellationToken);

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            return "Authentication failed. Verify username and password.";
        }

        if (!response.IsSuccessStatusCode)
        {
            return "Authentication service is unavailable. Try again shortly.";
        }

        var payload = await response.Content.ReadFromJsonAsync<LoginResponse>(cancellationToken: cancellationToken);
        if (payload is null || string.IsNullOrWhiteSpace(payload.AccessToken) || payload.ExpiresAtUtc <= DateTimeOffset.UtcNow)
        {
            return "Authentication response was invalid. Try again.";
        }

        // Resolve the authoritative username through /me while the fresh token is valid.
        var resolvedUsername = username.Trim();
        using var profileRequest = new HttpRequestMessage(HttpMethod.Get, "api/auth/me");
        profileRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", payload.AccessToken);
        using var profileResponse = await httpClient.SendAsync(profileRequest, cancellationToken);

        if (profileResponse.IsSuccessStatusCode)
        {
            var profile = await profileResponse.Content.ReadFromJsonAsync<CurrentAdminResponse>(cancellationToken: cancellationToken);
            if (!string.IsNullOrWhiteSpace(profile?.Username))
            {
                resolvedUsername = profile.Username;
            }
        }

        authSession.SignIn(resolvedUsername, payload.AccessToken, payload.ExpiresAtUtc);
        return null;
    }

    /// <inheritdoc />
    public void Logout()
    {
        authSession.SignOut();
    }
}
