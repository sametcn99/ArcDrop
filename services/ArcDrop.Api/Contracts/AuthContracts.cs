namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents fixed-admin login request credentials.
/// </summary>
/// <param name="Username">Admin username supplied by the client.</param>
/// <param name="Password">Admin password supplied by the client.</param>
public sealed record LoginRequest(string Username, string Password);

/// <summary>
/// Represents the successful login response containing a bearer token and expiration metadata.
/// </summary>
/// <param name="AccessToken">Signed JWT token used for authenticated API calls.</param>
/// <param name="ExpiresAtUtc">UTC timestamp at which the token expires.</param>
public sealed record LoginResponse(string AccessToken, DateTimeOffset ExpiresAtUtc);

/// <summary>
/// Represents authenticated admin profile details returned by the session validation endpoint.
/// </summary>
/// <param name="Username">Authenticated admin username claim.</param>
/// <param name="Authenticated">Indicates whether the current request is authenticated.</param>
public sealed record CurrentAdminResponse(string Username, bool Authenticated);

/// <summary>
/// Represents password rotation input for the fixed-admin account.
/// </summary>
/// <param name="CurrentPassword">Current valid admin password used as proof of possession.</param>
/// <param name="NewPassword">New candidate password that must satisfy policy checks.</param>
public sealed record RotateAdminPasswordRequest(string CurrentPassword, string NewPassword);
