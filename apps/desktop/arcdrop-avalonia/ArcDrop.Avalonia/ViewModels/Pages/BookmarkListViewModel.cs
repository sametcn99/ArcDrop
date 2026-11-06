using System.Collections.ObjectModel;
using System.Windows.Input;
using ArcDrop.Application.Bookmarks;
using ArcDrop.Avalonia.Services;

namespace ArcDrop.Avalonia.ViewModels.Pages;

/// <summary>
/// Wraps one bookmark row with two-step delete confirmation state.
/// </summary>
public sealed class BookmarkRowViewModel : ViewModelBase
{
    private bool _isDeleteConfirm;

    public BookmarkRowViewModel(BookmarkListItem bookmark)
    {
        Bookmark = bookmark;
    }

    public BookmarkListItem Bookmark { get; }

    public string Title => Bookmark.Title;

    public string Url => Bookmark.Url;

    public string TagsText => Bookmark.Tags is { Count: > 0 }
        ? string.Join(", ", Bookmark.Tags)
        : string.Empty;

    public string UpdatedText => Bookmark.UpdatedAtUtc.ToLocalTime().ToString("g");

    public bool IsDeleteConfirm
    {
        get => _isDeleteConfirm;
        set
        {
            if (SetProperty(ref _isDeleteConfirm, value))
            {
                OnPropertyChanged(nameof(DeleteButtonText));
            }
        }
    }

    public string DeleteButtonText => IsDeleteConfirm ? "Confirm?" : "Delete";
}

/// <summary>
/// Bookmark list page with server-side search, create/edit navigation, and two-step deletes.
/// </summary>
public sealed class BookmarkListViewModel : ViewModelBase
{
    private static readonly TimeSpan ConfirmResetDelay = TimeSpan.FromSeconds(3);

    private readonly ApiBookmarkClient _bookmarkClient;
    private readonly INavigationService _navigation;
    private string _searchText = string.Empty;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = "Loading bookmarks...";
    private BookmarkRowViewModel? _pendingDeleteRow;
    private CancellationTokenSource? _confirmResetCts;

    public BookmarkListViewModel(ApiBookmarkClient bookmarkClient, INavigationService navigation)
    {
        _bookmarkClient = bookmarkClient;
        _navigation = navigation;
        SearchCommand = new Command(async () => await LoadAsync(), () => !IsBusy);
        RefreshCommand = new Command(async () => await LoadAsync(), () => !IsBusy);
        AddCommand = new Command(() => _navigation.ShowBookmarkEditor(null));
        EditCommand = new Command<BookmarkRowViewModel>(row => { if (row is not null) { _navigation.ShowBookmarkEditor(row.Bookmark); } });
        DeleteCommand = new Command<BookmarkRowViewModel>(row => { if (row is not null) { _ = DeleteAsync(row); } });
    }

    public ObservableCollection<BookmarkRowViewModel> Bookmarks { get; } = [];

    public string SearchText
    {
        get => _searchText;
        set => SetProperty(ref _searchText, value);
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

    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    public ICommand SearchCommand { get; }

    public ICommand RefreshCommand { get; }

    public ICommand AddCommand { get; }

    public ICommand EditCommand { get; }

    public ICommand DeleteCommand { get; }

    /// <summary>
    /// Loads one page of bookmarks with the current server-side search term.
    /// </summary>
    public async Task LoadAsync()
    {
        IsBusy = true;
        ErrorText = null;
        StatusText = string.IsNullOrWhiteSpace(SearchText) ? "Loading bookmarks..." : $"Searching for '{SearchText.Trim()}'...";

        try
        {
            var bookmarks = await _bookmarkClient.GetBookmarksAsync(SearchText, CancellationToken.None);
            Bookmarks.Clear();
            foreach (var bookmark in bookmarks)
            {
                Bookmarks.Add(new BookmarkRowViewModel(bookmark));
            }

            StatusText = $"{bookmarks.Count} bookmark(s) shown.";
        }
        catch (Exception)
        {
            ErrorText = "Could not load bookmarks. Verify the API is running and the session is valid.";
            StatusText = "Bookmark loading failed.";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task DeleteAsync(BookmarkRowViewModel row)
    {
        if (!ReferenceEquals(_pendingDeleteRow, row) || !row.IsDeleteConfirm)
        {
            // First click arms the confirmation; the second click within the window deletes.
            ResetPendingDelete();
            _pendingDeleteRow = row;
            row.IsDeleteConfirm = true;
            ScheduleConfirmReset();
            return;
        }

        IsBusy = true;
        ErrorText = null;

        try
        {
            await _bookmarkClient.DeleteBookmarkAsync(row.Bookmark.Id, CancellationToken.None);
            Bookmarks.Remove(row);
            ResetPendingDelete();
            StatusText = "Bookmark deleted.";
        }
        catch (Exception)
        {
            ErrorText = "Bookmark deletion failed.";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void ScheduleConfirmReset()
    {
        _confirmResetCts?.Cancel();
        _confirmResetCts?.Dispose();
        _confirmResetCts = new CancellationTokenSource();

        var cts = _confirmResetCts;
        _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(ConfirmResetDelay, cts.Token);
                }
                catch (OperationCanceledException)
                {
                    return;
                }

                ResetPendingDelete();
            });
    }

    private void ResetPendingDelete()
    {
        _pendingDeleteRow = null;
        foreach (var row in Bookmarks.Where(row => row.IsDeleteConfirm))
        {
            row.IsDeleteConfirm = false;
        }
    }
}
