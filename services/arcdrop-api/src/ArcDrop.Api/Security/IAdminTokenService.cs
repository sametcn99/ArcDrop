namespace ArcDrop.Api.Security;

/// <summary>
/// Provides JWT token issuance for authenticated fixed-admin sessions.
/// </summary>
public interface IAdminTokenService
{
    /// <summary>
    /// Creates a signed JWT access token for the specified admin identity.
    /// </summary>
    (string AccessToken, DateTimeOffset ExpiresAtUtc) CreateAccessToken(string username);
}
