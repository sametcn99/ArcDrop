using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Avalonia.Services;

/// <summary>
/// Defines workspace navigation intents shared by page view models.
/// </summary>
public interface INavigationService
{
    /// <summary>
    /// Shows the dashboard overview page.
    /// </summary>
    void ShowDashboard();

    /// <summary>
    /// Shows the bookmark list page.
    /// </summary>
    void ShowBookmarks();

    /// <summary>
    /// Shows the bookmark editor. A null bookmark starts create mode.
    /// </summary>
    void ShowBookmarkEditor(BookmarkListItem? bookmark);

    /// <summary>
    /// Shows the settings page.
    /// </summary>
    void ShowSettings();

    /// <summary>
    /// Ends the admin session and returns to the login window.
    /// </summary>
    void RequestSignOut();

    /// <summary>
    /// Registers the active main-window handler; called once during shell startup.
    /// </summary>
    void Initialize(INavigationHandler handler);
}

/// <summary>
/// Realizes navigation intents inside the main window.
/// </summary>
public interface INavigationHandler
{
    void ShowDashboard();

    void ShowBookmarks();

    void ShowBookmarkEditor(BookmarkListItem? bookmark);

    void ShowSettings();

    void RequestSignOut();
}

/// <summary>
/// Default navigation dispatcher that forwards to the registered main window handler.
/// </summary>
public sealed class NavigationService : INavigationService
{
    private INavigationHandler? _handler;

    /// <inheritdoc />
    public void Initialize(INavigationHandler handler)
    {
        _handler = handler;
    }

    /// <inheritdoc />
    public void ShowDashboard() => _handler?.ShowDashboard();

    /// <inheritdoc />
    public void ShowBookmarks() => _handler?.ShowBookmarks();

    /// <inheritdoc />
    public void ShowBookmarkEditor(BookmarkListItem? bookmark) => _handler?.ShowBookmarkEditor(bookmark);

    /// <inheritdoc />
    public void ShowSettings() => _handler?.ShowSettings();

    /// <inheritdoc />
    public void RequestSignOut() => _handler?.RequestSignOut();
}
