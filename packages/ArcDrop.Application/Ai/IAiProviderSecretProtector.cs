namespace ArcDrop.Application.Ai;

/// <summary>
/// Provides encryption and masking operations for AI provider API keys.
/// </summary>
public interface IAiProviderSecretProtector
{
    /// <summary>
    /// Encrypts plaintext API key values before persistence.
    /// </summary>
    string Protect(string plainTextSecret);

    /// <summary>
    /// Returns a safe preview string that does not expose the full secret value.
    /// </summary>
    string CreateMaskedPreview(string plainTextSecret);
}