namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents the readiness payload returned by the root API endpoint.
/// </summary>
/// <param name="Service">Service name shown to operators and smoke tests.</param>
/// <param name="Message">Short readiness message confirming bootstrap success.</param>
/// <param name="UtcTimestamp">UTC timestamp captured when the readiness payload was generated.</param>
public sealed record ApiReadinessResponse(string Service, string Message, DateTimeOffset UtcTimestamp);

/// <summary>
/// Represents the compact health payload returned by the health endpoint.
/// </summary>
/// <param name="Status">Overall health state for deployment probes.</param>
/// <param name="Service">Service name shown in operational diagnostics.</param>
/// <param name="Environment">Current hosting environment name.</param>
/// <param name="AdminConfigurationDetected">Whether fixed-admin credentials are configured without exposing their values.</param>
/// <param name="UtcTimestamp">UTC timestamp captured when the health payload was generated.</param>
public sealed record ApiHealthResponse(
    string Status,
    string Service,
    string Environment,
    bool AdminConfigurationDetected,
    DateTimeOffset UtcTimestamp);