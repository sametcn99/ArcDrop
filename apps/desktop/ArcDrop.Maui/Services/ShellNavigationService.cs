namespace ArcDrop.Maui.Services;

/// <summary>
/// Implements shell-based navigation through the current MAUI shell host.
/// The service fails fast when shell is unavailable to avoid hidden navigation no-ops.
/// </summary>
public sealed class ShellNavigationService : INavigationService
{
    /// <inheritdoc />
    public async Task GoToAsync(string route, IDictionary<string, object>? parameters = null)
    {
        if (Shell.Current is null)
        {
            throw new InvalidOperationException("Shell navigation is unavailable before AppShell is initialized.");
        }

        await Shell.Current.GoToAsync(route, parameters ?? new Dictionary<string, object>());
    }
}
