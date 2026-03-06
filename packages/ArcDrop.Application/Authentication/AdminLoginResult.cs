namespace ArcDrop.Application.Authentication;

/// <summary>
/// Represents the result of a fixed-admin login attempt.
/// </summary>
public sealed record AdminLoginResult(
    bool Success,
    string? AccessToken,
    DateTimeOffset? ExpiresAtUtc);