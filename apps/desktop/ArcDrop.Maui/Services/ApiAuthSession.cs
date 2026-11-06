using System.Globalization;

namespace ArcDrop.Maui.Services;

/// <summary>
/// Secure-storage-backed implementation of the desktop admin API session.
/// </summary>
public sealed class ApiAuthSession : IApiAuthSession
{
    private const string TokenKey = "arcdrop.access_token";
    private const string UsernameKey = "arcdrop.username";
    private const string ExpiryKey = "arcdrop.expires_at_unix";

    public bool IsAuthenticated => GetValidToken() is not null;

    public string? Username => Preferences.Get(UsernameKey, null);

    public DateTimeOffset? ExpiresAtUtc
    {
        get
        {
            var rawExpiry = Preferences.Get(ExpiryKey, string.Empty);
            return long.TryParse(rawExpiry, NumberStyles.Integer, CultureInfo.InvariantCulture, out var expiresAtUnix)
                ? DateTimeOffset.FromUnixTimeSeconds(expiresAtUnix)
                : null;
        }
    }

    /// <inheritdoc />
    public string? GetValidToken()
    {
        var token = Preferences.Get(TokenKey, null);
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        if (ExpiresAtUtc is { } expiry && expiry <= DateTimeOffset.UtcNow)
        {
            // Expired sessions fail closed so callers are pushed back to the login flow.
            return null;
        }

        return token;
    }

    /// <inheritdoc />
    public Task SignInAsync(string username, string accessToken, DateTimeOffset expiresAtUtc)
    {
        Preferences.Set(TokenKey, accessToken);
        Preferences.Set(UsernameKey, username);
        Preferences.Set(ExpiryKey, expiresAtUtc.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SignOutAsync()
    {
        Preferences.Remove(TokenKey);
        Preferences.Remove(UsernameKey);
        Preferences.Remove(ExpiryKey);
        return Task.CompletedTask;
    }
}
