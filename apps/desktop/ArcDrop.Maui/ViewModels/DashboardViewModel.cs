using System.Windows.Input;
using ArcDrop.Maui.Services;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Provides shell-level dashboard state for initial TASK-005 desktop foundation.
/// This view model intentionally keeps business workflows out of the UI layer.
/// </summary>
public sealed class DashboardViewModel : ViewModelBase
{
    private readonly INavigationService _navigationService;

    private string _headerText = "ArcDrop Desktop";
    private string _subtitleText = "MVVM shell foundation is active.";

    public DashboardViewModel(INavigationService navigationService)
    {
        _navigationService = navigationService;
        OpenSettingsCommand = new Command(async () => await OpenSettingsAsync());
        OpenBookmarksCommand = new Command(async () => await OpenBookmarksAsync());
    }

    /// <summary>
    /// Headline shown on the landing dashboard surface.
    /// </summary>
    public string HeaderText
    {
        get => _headerText;
        private set => SetProperty(ref _headerText, value);
    }

    /// <summary>
    /// Subheadline explaining current application state.
    /// </summary>
    public string SubtitleText
    {
        get => _subtitleText;
        private set => SetProperty(ref _subtitleText, value);
    }

    /// <summary>
    /// Opens the settings route to validate shell routing and command bindings.
    /// </summary>
    public ICommand OpenSettingsCommand { get; }

    /// <summary>
    /// Opens bookmark list workflows from the dashboard entry surface.
    /// </summary>
    public ICommand OpenBookmarksCommand { get; }

    private async Task OpenSettingsAsync()
    {
        await _navigationService.GoToAsync(nameof(Views.SettingsPage));
    }

    private async Task OpenBookmarksAsync()
    {
        await _navigationService.GoToAsync(nameof(Views.BookmarkListPage));
    }
}
