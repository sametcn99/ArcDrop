namespace ArcDrop.Application.Authentication;

/// <summary>
/// Executes fixed-admin authentication and password rotation use cases.
/// The service is intentionally small because credential storage and token issuance are delegated behind explicit contracts.
/// </summary>
public sealed class AdminAuthenticationService(
    IAdminCredentialService credentialService,
    IAdminTokenService tokenService) : IAdminAuthenticationService
{
    /// <inheritdoc />
    public Task<AdminLoginResult> LoginAsync(string username, string password, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (!credentialService.ValidateCredentials(username, password))
        {
            return Task.FromResult(new AdminLoginResult(false, null, null));
        }

        var (accessToken, expiresAtUtc) = tokenService.CreateAccessToken(credentialService.Username);
        return Task.FromResult(new AdminLoginResult(true, accessToken, expiresAtUtc));
    }

    /// <inheritdoc />
    public Task<AdminPasswordRotationResult> RotatePasswordAsync(
        string username,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(credentialService.TryRotatePassword(username, currentPassword, newPassword));
    }
}