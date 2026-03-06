using ArcDrop.Application.Authentication;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Verifies application-layer admin authentication orchestration without relying on HTTP transport setup.
/// These tests protect the refactor that moved auth logic out of the API endpoint layer.
/// </summary>
public sealed class AdminAuthenticationServiceTests
{
    /// <summary>
    /// Verifies that unsuccessful credential validation does not issue a token.
    /// </summary>
    [Fact]
    public async Task LoginAsync_WithInvalidCredentials_ReturnsFailureWithoutToken()
    {
        var service = new AdminAuthenticationService(
            new StubCredentialService(validateCredentialsResult: false),
            new StubTokenService());

        var result = await service.LoginAsync("admin", "wrong-password", CancellationToken.None);

        Assert.False(result.Success);
        Assert.Null(result.AccessToken);
        Assert.Null(result.ExpiresAtUtc);
    }

    /// <summary>
    /// Verifies that password rotation surfaces a credential failure distinctly from policy validation issues.
    /// </summary>
    [Fact]
    public async Task RotatePasswordAsync_WhenCredentialProofFails_ReturnsUnauthorizedResult()
    {
        var expected = new AdminPasswordRotationResult(false, true, "Current credentials are invalid.");
        var service = new AdminAuthenticationService(
            new StubCredentialService(rotationResult: expected),
            new StubTokenService());

        var result = await service.RotatePasswordAsync("admin", "old", "new", CancellationToken.None);

        Assert.Equal(expected, result);
    }

    private sealed class StubCredentialService(
        bool validateCredentialsResult = true,
        AdminPasswordRotationResult? rotationResult = null) : IAdminCredentialService
    {
        public string Username => "admin";

        public bool IsConfigured => true;

        public bool ValidateCredentials(string username, string password)
        {
            return validateCredentialsResult;
        }

        public AdminPasswordRotationResult TryRotatePassword(string username, string currentPassword, string newPassword)
        {
            return rotationResult ?? new AdminPasswordRotationResult(true, false, null);
        }
    }

    private sealed class StubTokenService : IAdminTokenService
    {
        public (string AccessToken, DateTimeOffset ExpiresAtUtc) CreateAccessToken(string username)
        {
            return ("token-value", DateTimeOffset.UtcNow.AddMinutes(30));
        }
    }
}