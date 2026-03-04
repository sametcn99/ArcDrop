namespace ArcDrop.Maui.Services;

/// <summary>
/// Defines shell-aware navigation operations used by MAUI view models.
/// Keeping navigation behind an interface prevents direct view-to-view coupling.
/// </summary>
public interface INavigationService
{
    /// <summary>
    /// Navigates to a named shell route.
    /// </summary>
    Task GoToAsync(string route, IDictionary<string, object>? parameters = null);
}
