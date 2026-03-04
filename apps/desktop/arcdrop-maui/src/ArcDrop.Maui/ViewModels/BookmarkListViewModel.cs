using System.Collections.ObjectModel;
using System.Windows.Input;
using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Drives bookmark list, refresh, and search workflows for initial FR-004 desktop flows.
/// Query execution is delegated to application contracts to preserve MVVM boundaries.
/// </summary>
public sealed class BookmarkListViewModel : ViewModelBase
{
    private readonly IBookmarkQueryService _bookmarkQueryService;
    private readonly Services.INavigationService _navigationService;

    private bool _isLoading;
    private string _searchText = string.Empty;
    private string _statusText = "Ready";

    public BookmarkListViewModel(
        IBookmarkQueryService bookmarkQueryService,
        Services.INavigationService navigationService)
    {
        _bookmarkQueryService = bookmarkQueryService;
        _navigationService = navigationService;

        Items = [];
        LoadBookmarksCommand = new Command(async () => await LoadBookmarksAsync());
        SearchCommand = new Command(async () => await LoadBookmarksAsync());
        OpenCreateBookmarkCommand = new Command(async () => await OpenCreateBookmarkAsync());
        OpenBookmarkCommand = new Command<BookmarkListItemViewModel>(async item => await OpenBookmarkAsync(item));
    }

    public ObservableCollection<BookmarkListItemViewModel> Items { get; }

    public ICommand LoadBookmarksCommand { get; }

    public ICommand SearchCommand { get; }

    public ICommand OpenCreateBookmarkCommand { get; }

    public ICommand OpenBookmarkCommand { get; }

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public string SearchText
    {
        get => _searchText;
        set => SetProperty(ref _searchText, value);
    }

    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    /// <summary>
    /// Loads bookmarks using current search input and updates list state.
    /// This method handles both initial page load and explicit refresh/search actions.
    /// </summary>
    public async Task LoadBookmarksAsync(CancellationToken cancellationToken = default)
    {
        if (IsLoading)
        {
            return;
        }

        IsLoading = true;
        StatusText = "Loading bookmarks...";

        try
        {
            var bookmarks = await _bookmarkQueryService.GetBookmarksAsync(SearchText, cancellationToken);

            Items.Clear();
            foreach (var bookmark in bookmarks)
            {
                Items.Add(new BookmarkListItemViewModel(bookmark));
            }

            StatusText = Items.Count == 0
                ? "No bookmarks matched the current filter."
                : $"Loaded {Items.Count} bookmark(s).";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Bookmark loading was canceled.";
        }
        catch (Exception)
        {
            // Keep failure text user-friendly here; detailed diagnostics will be introduced with logging adapters.
            StatusText = "Bookmark loading failed.";
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task OpenBookmarkAsync(BookmarkListItemViewModel? item)
    {
        if (item is null)
        {
            return;
        }

        await _navigationService.GoToAsync($"{nameof(Views.BookmarkDetailPage)}?bookmarkId={item.Id}");
    }

    private async Task OpenCreateBookmarkAsync()
    {
        await _navigationService.GoToAsync(nameof(Views.CreateBookmarkPage));
    }
}
