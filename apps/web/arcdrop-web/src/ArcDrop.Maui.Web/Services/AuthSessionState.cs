namespace ArcDrop.Web.Services;

/// <summary>
/// Holds the authenticated admin session for the current Blazor circuit.
/// The state is intentionally kept in-memory to avoid persisting bearer tokens in browser storage.
/// </summary>
public sealed class AuthSessionState
{
    /// <summary>
    /// Gets the active access token used for authenticated API calls.
    /// </summary>
    public string? AccessToken { get; private set; }

    /// <summary>
    /// Gets the UTC expiration timestamp of the active token.
    /// </summary>
    public DateTimeOffset? ExpiresAtUtc { get; private set; }

    /// <summary>
    /// Gets the resolved admin username once profile lookup has completed.
    /// </summary>
    public string? Username { get; private set; }

    /// <summary>
    /// Indicates whether an access token is present and not expired.
    /// </summary>
    public bool IsAuthenticated =>
        !string.IsNullOrWhiteSpace(AccessToken) &&
        ExpiresAtUtc is not null &&
        ExpiresAtUtc.Value > DateTimeOffset.UtcNow;

    /// <summary>
    /// Stores a newly issued token and clears any stale profile projection.
    /// </summary>
    public void SetSession(string accessToken, DateTimeOffset expiresAtUtc)
    {
        AccessToken = accessToken;
        ExpiresAtUtc = expiresAtUtc;
        Username = null;
    }

    /// <summary>
    /// Updates the cached username after a successful profile query.
    /// </summary>
    public void SetUsername(string username)
    {
        Username = username;
    }

    /// <summary>
    /// Clears all authentication state to force re-login.
    /// </summary>
    public void Clear()
    {
        AccessToken = null;
        ExpiresAtUtc = null;
        Username = null;
    }
}
