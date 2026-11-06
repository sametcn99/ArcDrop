using System.Windows.Input;
using ArcDrop.Avalonia.Services;

namespace ArcDrop.Avalonia.ViewModels.Pages;

/// <summary>
/// Workspace overview page showing library counters and quick actions.
/// </summary>
public sealed class DashboardViewModel : ViewModelBase
{
    private readonly ApiBookmarkClient _bookmarkClient;
    private readonly INavigationService _navigation;
    private int _totalCount;
    private int _unassignedCount;
    private bool _isBusy;
    private string? _errorText;

    public DashboardViewModel(ApiBookmarkClient bookmarkClient, INavigationService navigation)
    {
        _bookmarkClient = bookmarkClient;
        _navigation = navigation;
        GoToBookmarksCommand = new Command(() => _navigation.ShowBookmarks());
        AddBookmarkCommand = new Command(() => _navigation.ShowBookmarkEditor(null));
    }

    public int TotalCount
    {
        get => _totalCount;
        private set => SetProperty(ref _totalCount, value);
    }

    public int UnassignedCount
    {
        get => _unassignedCount;
        private set => SetProperty(ref _unassignedCount, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    public string? ErrorText
    {
        get => _errorText;
        private set => SetProperty(ref _errorText, value);
    }

    public string WelcomeText => $"Signed in workspace for {Environment.UserName}";

    public ICommand GoToBookmarksCommand { get; }

    public ICommand AddBookmarkCommand { get; }

    /// <summary>
    /// Loads dashboard counters from the API stats endpoint.
    /// </summary>
    public async Task LoadAsync()
    {
        IsBusy = true;
        ErrorText = null;

        try
        {
            (TotalCount, UnassignedCount) = await _bookmarkClient.GetStatsAsync(CancellationToken.None);
        }
        catch (Exception)
        {
            ErrorText = "Could not load dashboard counters. Verify the API is running and the session is valid.";
        }
        finally
        {
            IsBusy = false;
        }
    }
}
