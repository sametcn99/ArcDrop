namespace ArcDrop.Avalonia.Services;

/// <summary>
/// Persists the ArcDrop admin API session for the Linux desktop client.
/// Tokens are stored in a user-local session file so restarts keep working.
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
    void SignIn(string username, string accessToken, DateTimeOffset expiresAtUtc);

    /// <summary>
    /// Clears the stored session.
    /// </summary>
    void SignOut();
}
