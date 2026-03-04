using System.Security.Cryptography;
using System.Text;
using ArcDrop.Api.Configuration;

namespace ArcDrop.Api.Security;

/// <summary>
/// Holds fixed-admin credentials in process memory and enforces rotation policy checks.
/// This implementation is intentionally simple for v1 bootstrap and can be replaced by
/// encrypted persistence in later milestones without changing endpoint contracts.
/// </summary>
public sealed class InMemoryAdminCredentialService : IAdminCredentialService
{
    private readonly object _syncLock = new();
    private readonly AdminCredentialPolicyOptions _policy;
    private string _username;
    private string _password;

    /// <summary>
    /// Creates credential state from validated bootstrap configuration.
    /// </summary>
    public InMemoryAdminCredentialService(string username, string password, AdminCredentialPolicyOptions policy)
    {
        _username = username;
        _password = password;
        _policy = policy;
    }

    /// <inheritdoc />
    public string Username
    {
        get
        {
            lock (_syncLock)
            {
                return _username;
            }
        }
    }

    /// <inheritdoc />
    public bool IsConfigured
    {
        get
        {
            lock (_syncLock)
            {
                return !string.IsNullOrWhiteSpace(_username) && !string.IsNullOrWhiteSpace(_password);
            }
        }
    }

    /// <inheritdoc />
    public bool ValidateCredentials(string username, string password)
    {
        lock (_syncLock)
        {
            return SecureEquals(username.Trim(), _username) && SecureEquals(password, _password);
        }
    }

    /// <inheritdoc />
    public (bool Success, string? ValidationError) TryRotatePassword(string username, string currentPassword, string newPassword)
    {
        lock (_syncLock)
        {
            if (!SecureEquals(username.Trim(), _username) || !SecureEquals(currentPassword, _password))
            {
                return (false, "Current credentials are invalid.");
            }

            var policyError = ValidatePasswordAgainstPolicy(newPassword);
            if (!string.IsNullOrWhiteSpace(policyError))
            {
                return (false, policyError);
            }

            _password = newPassword;
            return (true, null);
        }
    }

    /// <summary>
    /// Validates candidate password against configured policy controls.
    /// </summary>
    private string? ValidatePasswordAgainstPolicy(string password)
    {
        if (password.Length < _policy.MinimumPasswordLength)
        {
            return $"Password must be at least {_policy.MinimumPasswordLength} characters long.";
        }

        if (_policy.RequireUppercase && !password.Any(char.IsUpper))
        {
            return "Password must include at least one uppercase letter.";
        }

        if (_policy.RequireLowercase && !password.Any(char.IsLower))
        {
            return "Password must include at least one lowercase letter.";
        }

        if (_policy.RequireDigit && !password.Any(char.IsDigit))
        {
            return "Password must include at least one digit.";
        }

        if (_policy.RequireSpecialCharacter && password.All(char.IsLetterOrDigit))
        {
            return "Password must include at least one special character.";
        }

        if (_policy.DisallowPasswordReuse && SecureEquals(password, _password))
        {
            return "New password must be different from the current password.";
        }

        return null;
    }

    /// <summary>
    /// Performs constant-time string comparison to reduce timing side-channel leakage.
    /// </summary>
    private static bool SecureEquals(string provided, string expected)
    {
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        var expectedBytes = Encoding.UTF8.GetBytes(expected);

        if (providedBytes.Length != expectedBytes.Length)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
    }
}
