namespace ArcDrop.Application.Authentication;

/// <summary>
/// Represents the result of a fixed-admin password rotation attempt.
/// This result separates authentication failure from policy validation failure so API callers can map status codes correctly.
/// </summary>
public sealed record AdminPasswordRotationResult(
    bool Success,
    bool CurrentCredentialsInvalid,
    string? ValidationError);