using System.Windows.Input;
using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Drives bookmark detail and edit flows for FR-004 desktop workflows.
/// </summary>
public sealed class BookmarkDetailViewModel : ViewModelBase
{
    private readonly IBookmarkQueryService _bookmarkQueryService;
    private readonly IBookmarkCommandService _bookmarkCommandService;

    private Guid _bookmarkId;
    private string _title = string.Empty;
    private string _url = string.Empty;
    private string? _summary;
    private string _statusText = "Select a bookmark to edit.";
    private bool _isBusy;

    public BookmarkDetailViewModel(
        IBookmarkQueryService bookmarkQueryService,
        IBookmarkCommandService bookmarkCommandService)
    {
        _bookmarkQueryService = bookmarkQueryService;
        _bookmarkCommandService = bookmarkCommandService;

        SaveCommand = new Command(async () => await SaveAsync());
    }

    public ICommand SaveCommand { get; }

    public Guid BookmarkId
    {
        get => _bookmarkId;
        private set => SetProperty(ref _bookmarkId, value);
    }

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
    }

    public string Url
    {
        get => _url;
        set => SetProperty(ref _url, value);
    }

    public string? Summary
    {
        get => _summary;
        set => SetProperty(ref _summary, value);
    }

    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set => SetProperty(ref _isBusy, value);
    }

    /// <summary>
    /// Loads bookmark detail state for the target bookmark identifier.
    /// </summary>
    public async Task LoadAsync(Guid bookmarkId, CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return;
        }

        IsBusy = true;
        StatusText = "Loading bookmark details...";

        try
        {
            var detail = await _bookmarkQueryService.GetBookmarkByIdAsync(bookmarkId, cancellationToken);
            if (detail is null)
            {
                StatusText = "Bookmark not found.";
                return;
            }

            BookmarkId = detail.Id;
            Title = detail.Title;
            Url = detail.Url;
            Summary = detail.Summary;
            StatusText = "Bookmark loaded.";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Bookmark loading was canceled.";
        }
        catch (Exception)
        {
            StatusText = "Bookmark loading failed.";
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>
    /// Persists edited bookmark values through application command contracts.
    /// </summary>
    public async Task SaveAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return;
        }

        if (BookmarkId == Guid.Empty)
        {
            StatusText = "No bookmark is selected for saving.";
            return;
        }

        IsBusy = true;
        StatusText = "Saving bookmark...";

        try
        {
            var updated = await _bookmarkCommandService.UpdateBookmarkAsync(
                new UpdateBookmarkInput(BookmarkId, Url, Title, Summary),
                cancellationToken);

            Title = updated.Title;
            Url = updated.Url;
            Summary = updated.Summary;
            StatusText = "Bookmark saved successfully.";
        }
        catch (OperationCanceledException)
        {
            StatusText = "Bookmark save was canceled.";
        }
        catch (Exception)
        {
            StatusText = "Bookmark save failed.";
        }
        finally
        {
            IsBusy = false;
        }
    }
}
