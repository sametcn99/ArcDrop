using System.Windows.Input;
using ArcDrop.Avalonia.Services;
using ArcDrop.Avalonia.ViewModels.Pages;

namespace ArcDrop.Avalonia.ViewModels;

/// <summary>
/// Shell view model hosting sidebar navigation and the current workspace page.
/// </summary>
public sealed class MainViewModel : ViewModelBase, INavigationHandler
{
    private readonly IApiAuthSession _authSession;
    private readonly LoginViewModel _loginViewModel;
    private readonly DashboardViewModel _dashboardViewModel;
    private readonly BookmarkListViewModel _bookmarkListViewModel;
    private readonly BookmarkEditViewModel _bookmarkEditViewModel;
    private readonly SettingsViewModel _settingsViewModel;
    private object _currentPage;

    /// <summary>
    /// Raised when the user requests leaving the authenticated workspace.
    /// </summary>
    public event EventHandler? SignOutRequested;

    public MainViewModel(
        IApiAuthSession authSession,
        INavigationService navigationService,
        LoginViewModel loginViewModel,
        DashboardViewModel dashboardViewModel,
        BookmarkListViewModel bookmarkListViewModel,
        BookmarkEditViewModel bookmarkEditViewModel,
        SettingsViewModel settingsViewModel)
    {
        _authSession = authSession;
        _loginViewModel = loginViewModel;
        _dashboardViewModel = dashboardViewModel;
        _bookmarkListViewModel = bookmarkListViewModel;
        _bookmarkEditViewModel = bookmarkEditViewModel;
        _settingsViewModel = settingsViewModel;
        _currentPage = dashboardViewModel;

        navigationService.Initialize(this);
        SignOutCommand = new Command(RequestSignOut);
        NavigateDashboardCommand = new Command(ShowDashboard);
        NavigateBookmarksCommand = new Command(ShowBookmarks);
        NavigateNewBookmarkCommand = new Command(() => ShowBookmarkEditor(null));
        NavigateSettingsCommand = new Command(ShowSettings);
    }

    /// <summary>
    /// The active workspace page view model rendered through App.axaml data templates.
    /// </summary>
    public object CurrentPage
    {
        get => _currentPage;
        private set => SetProperty(ref _currentPage, value);
    }

    public string Username => _authSession.Username ?? "admin";

    public ICommand SignOutCommand { get; }

    public ICommand NavigateDashboardCommand { get; }

    public ICommand NavigateBookmarksCommand { get; }

    public ICommand NavigateNewBookmarkCommand { get; }

    public ICommand NavigateSettingsCommand { get; }

    /// <summary>
    /// Loads initial page data after the shell window is shown.
    /// </summary>
    public async Task InitializeAsync()
    {
        await _dashboardViewModel.LoadAsync();
        OnPropertyChanged(nameof(Username));
    }

    /// <inheritdoc />
    public void ShowDashboard()
    {
        CurrentPage = _dashboardViewModel;
        _ = _dashboardViewModel.LoadAsync();
    }

    /// <inheritdoc />
    public void ShowBookmarks()
    {
        CurrentPage = _bookmarkListViewModel;
        _ = _bookmarkListViewModel.LoadAsync();
    }

    /// <inheritdoc />
    public void ShowBookmarkEditor(Application.Bookmarks.BookmarkListItem? bookmark)
    {
        _bookmarkEditViewModel.Prepare(bookmark is null ? null : bookmark.Id);
        CurrentPage = _bookmarkEditViewModel;
        _ = _bookmarkEditViewModel.LoadAsync();
    }

    /// <inheritdoc />
    public void ShowSettings()
    {
        CurrentPage = _settingsViewModel;
        _settingsViewModel.Refresh();
    }

    /// <inheritdoc />
    public void RequestSignOut()
    {
        _loginViewModel.Reset();
        SignOutRequested?.Invoke(this, EventArgs.Empty);
    }
}
