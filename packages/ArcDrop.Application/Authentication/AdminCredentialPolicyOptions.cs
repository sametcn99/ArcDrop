using System.ComponentModel.DataAnnotations;

namespace ArcDrop.Application.Authentication;

/// <summary>
/// Defines fixed-admin credential policy rules enforced during password rotation.
/// The policy is configurable to support stricter deployments without code changes.
/// </summary>
public sealed class AdminCredentialPolicyOptions
{
    /// <summary>
    /// Configuration section name used by appsettings and ARCDROP_ environment variables.
    /// </summary>
    public const string SectionName = "AdminCredentialPolicy";

    /// <summary>
    /// Minimum allowed password length.
    /// </summary>
    [Range(8, 256)]
    public int MinimumPasswordLength { get; init; } = 12;

    /// <summary>
    /// Requires at least one uppercase letter when enabled.
    /// </summary>
    public bool RequireUppercase { get; init; } = true;

    /// <summary>
    /// Requires at least one lowercase letter when enabled.
    /// </summary>
    public bool RequireLowercase { get; init; } = true;

    /// <summary>
    /// Requires at least one numeric character when enabled.
    /// </summary>
    public bool RequireDigit { get; init; } = true;

    /// <summary>
    /// Requires at least one non-alphanumeric symbol when enabled.
    /// </summary>
    public bool RequireSpecialCharacter { get; init; } = true;

    /// <summary>
    /// Prevents rotating to the same password value when enabled.
    /// </summary>
    public bool DisallowPasswordReuse { get; init; } = true;
}