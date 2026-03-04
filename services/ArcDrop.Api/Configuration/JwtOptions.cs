using System.ComponentModel.DataAnnotations;

namespace ArcDrop.Api.Configuration;

/// <summary>
/// Represents JWT token settings used by the fixed-admin authentication flow.
/// The values are validated at startup to fail fast on weak or incomplete security configuration.
/// </summary>
public sealed class JwtOptions
{
    /// <summary>
    /// Configuration section name used for binding from appsettings and environment variables.
    /// </summary>
    public const string SectionName = "Jwt";

    /// <summary>
    /// Expected token issuer value used during token validation.
    /// </summary>
    [Required]
    public string Issuer { get; init; } = string.Empty;

    /// <summary>
    /// Expected token audience value used during token validation.
    /// </summary>
    [Required]
    public string Audience { get; init; } = string.Empty;

    /// <summary>
    /// Symmetric signing key used to sign and validate JWT tokens.
    /// Minimum length checks are validated during startup.
    /// </summary>
    [Required]
    [MinLength(32)]
    public string SigningKey { get; init; } = string.Empty;

    /// <summary>
    /// Token lifetime in minutes for issued admin session tokens.
    /// </summary>
    [Range(1, 240)]
    public int AccessTokenLifetimeMinutes { get; init; } = 60;
}
