namespace ArcDrop.Maui.Services;

/// <summary>
/// Executes fixed-admin authentication flows for the desktop client.
/// </summary>
public interface IApiAuthService
{
    /// <summary>
    /// Signs in against the API and persists the session.
    /// Returns an error message when sign-in fails, or null on success.
    /// </summary>
    Task<string?> LoginAsync(string username, string password, CancellationToken cancellationToken);

    /// <summary>
    /// Clears the persisted session.
    /// </summary>
    Task LogoutAsync();
}
