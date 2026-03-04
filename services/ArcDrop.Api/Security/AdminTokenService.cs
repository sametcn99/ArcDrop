using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ArcDrop.Api.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace ArcDrop.Api.Security;

/// <summary>
/// Creates JWT access tokens for the fixed-admin authentication model.
/// The service keeps token generation behavior centralized to simplify future rotation and auditing work.
/// </summary>
public sealed class AdminTokenService(JwtOptions jwtOptions) : IAdminTokenService
{
    /// <summary>
    /// Creates a signed JWT token with issuer, audience, and core identity claims.
    /// </summary>
    public (string AccessToken, DateTimeOffset ExpiresAtUtc) CreateAccessToken(string username)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = now.AddMinutes(jwtOptions.AccessTokenLifetimeMinutes);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, username),
            new(JwtRegisteredClaimNames.UniqueName, username),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(ClaimTypes.Role, "Admin")
        };

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey));
        var signingCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: jwtOptions.Issuer,
            audience: jwtOptions.Audience,
            claims: claims,
            notBefore: now.UtcDateTime,
            expires: expiresAt.UtcDateTime,
            signingCredentials: signingCredentials);

        var tokenValue = new JwtSecurityTokenHandler().WriteToken(token);
        return (tokenValue, expiresAt);
    }
}
