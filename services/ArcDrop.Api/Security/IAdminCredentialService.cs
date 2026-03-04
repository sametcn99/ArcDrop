namespace ArcDrop.Api.Security;

/// <summary>
/// Provides fixed-admin credential validation and secure password rotation behavior.
/// </summary>
public interface IAdminCredentialService
{
    /// <summary>
    /// Returns the current fixed-admin username.
    /// </summary>
    string Username { get; }

    /// <summary>
    /// Indicates whether credential values are configured and available.
    /// </summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Validates supplied login credentials against the current fixed-admin values.
    /// </summary>
    bool ValidateCredentials(string username, string password);

    /// <summary>
    /// Attempts to rotate the fixed-admin password using current credential proof.
    /// </summary>
    (bool Success, string? ValidationError) TryRotatePassword(string username, string currentPassword, string newPassword);
}
