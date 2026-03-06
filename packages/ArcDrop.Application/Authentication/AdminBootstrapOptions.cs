using System.ComponentModel.DataAnnotations;

namespace ArcDrop.Application.Authentication;

/// <summary>
/// Represents the fixed-admin bootstrap credentials used by ArcDrop v1.
/// The current product scope intentionally supports a single admin identity,
/// so these values are validated at startup to fail fast on bad configuration.
/// </summary>
public sealed class AdminBootstrapOptions
{
    /// <summary>
    /// Configuration section name used across appsettings and environment variable mapping.
    /// Example environment variables with ARCDROP_ prefix:
    /// ARCDROP_Admin__Username and ARCDROP_Admin__Password.
    /// </summary>
    public const string SectionName = "Admin";

    /// <summary>
    /// Login username for the fixed-admin account.
    /// </summary>
    [Required]
    [MinLength(3)]
    public string Username { get; init; } = string.Empty;

    /// <summary>
    /// Login password for the fixed-admin account.
    /// </summary>
    [Required]
    [MinLength(8)]
    public string Password { get; init; } = string.Empty;
}