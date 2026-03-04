using Microsoft.AspNetCore.DataProtection;

namespace ArcDrop.Api.Security;

/// <summary>
/// Uses ASP.NET Core data protection to encrypt AI provider secrets before database persistence.
/// </summary>
public sealed class AiProviderSecretProtector(IDataProtectionProvider dataProtectionProvider) : IAiProviderSecretProtector
{
    private readonly IDataProtector _dataProtector =
        dataProtectionProvider.CreateProtector("ArcDrop.AiProviderConfig.ApiKey.v1");

    /// <inheritdoc />
    public string Protect(string plainTextSecret)
    {
        return _dataProtector.Protect(plainTextSecret);
    }

    /// <inheritdoc />
    public string CreateMaskedPreview(string plainTextSecret)
    {
        if (string.IsNullOrWhiteSpace(plainTextSecret))
        {
            return "<empty>";
        }

        if (plainTextSecret.Length <= 4)
        {
            return new string('*', plainTextSecret.Length);
        }

        var suffix = plainTextSecret[^4..];
        return $"****{suffix}";
    }
}
