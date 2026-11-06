namespace ArcDrop.Maui.Services;

/// <summary>
/// Persists the ArcDrop admin API session for the desktop client.
/// Tokens are stored in device-local preferences storage so background starts keep working.
/// </summary>
public interface IApiAuthSession
{
    /// <summary>
    /// Returns true when a token exists and has not expired.
    /// </summary>
    bool IsAuthenticated { get; }

    /// <summary>
    /// Returns the stored username for display surfaces, or null when signed out.
    /// </summary>
    string? Username { get; }

    /// <summary>
    /// Returns the stored token expiry in UTC, or null when signed out.
    /// </summary>
    DateTimeOffset? ExpiresAtUtc { get; }

    /// <summary>
    /// Returns the stored bearer token, or null when signed out or expired.
    /// </summary>
    string? GetValidToken();

    /// <summary>
    /// Persists a successful login session.
    /// </summary>
    Task SignInAsync(string username, string accessToken, DateTimeOffset expiresAtUtc);

    /// <summary>
    /// Clears the stored session.
    /// </summary>
    Task SignOutAsync();
}
