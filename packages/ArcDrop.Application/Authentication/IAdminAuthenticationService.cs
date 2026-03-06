namespace ArcDrop.Application.Authentication;

/// <summary>
/// Coordinates fixed-admin authentication workflows so HTTP endpoints can stay transport-focused.
/// </summary>
public interface IAdminAuthenticationService
{
    /// <summary>
    /// Attempts to authenticate the configured admin account and returns a token payload on success.
    /// </summary>
    Task<AdminLoginResult> LoginAsync(string username, string password, CancellationToken cancellationToken);

    /// <summary>
    /// Attempts to rotate the configured admin password using proof of the current password.
    /// </summary>
    Task<AdminPasswordRotationResult> RotatePasswordAsync(string username, string currentPassword, string newPassword, CancellationToken cancellationToken);
}