namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents a user-supplied AI provider configuration for ArcDrop automation workflows.
/// Secret values are stored as encrypted ciphertext and never exposed through API responses.
/// </summary>
public sealed class AiProviderConfig
{
    /// <summary>
    /// Stable identifier for internal persistence and audit references.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Provider name key used by clients to select a configuration (for example: OpenAI).
    /// </summary>
    public string ProviderName { get; set; } = string.Empty;

    /// <summary>
    /// API endpoint base URL used for outbound provider calls.
    /// </summary>
    public string ApiEndpoint { get; set; } = string.Empty;

    /// <summary>
    /// Default model name configured for this provider profile.
    /// </summary>
    public string Model { get; set; } = string.Empty;

    /// <summary>
    /// Encrypted API key ciphertext protected by the host data protection system.
    /// </summary>
    public string ApiKeyCipherText { get; set; } = string.Empty;

    /// <summary>
    /// Creation timestamp in UTC for audit and troubleshooting.
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Last update timestamp in UTC for change tracking.
    /// </summary>
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
