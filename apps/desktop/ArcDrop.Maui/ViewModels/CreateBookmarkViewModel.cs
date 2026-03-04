using System.Windows.Input;
using ArcDrop.Application.Bookmarks;
using ArcDrop.Maui.Services;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Drives add-bookmark form state and create command execution for FR-004 flows.
/// </summary>
public sealed class CreateBookmarkViewModel : ViewModelBase
{
    private readonly IBookmarkCommandService _bookmarkCommandService;
    private readonly INavigationService _navigationService;

    private string _url = string.Empty;
    private string _title = string.Empty;
    private string? _summary;
    private string _statusText = "Fill the form and save.";
    private bool _isBusy;

    public CreateBookmarkViewModel(
        IBookmarkCommandService bookmarkCommandService,
        INavigationService navigationService)
    {
        _bookmarkCommandService = bookmarkCommandService;
        _navigationService = navigationService;

        SaveCommand = new Command(async () => await SaveAsync());
    }

    public ICommand SaveCommand { get; }

    public string Url
    {
        get => _url;
        set => SetProperty(ref _url, value);
    }

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
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
    /// Creates a bookmark and returns to list workflow when command succeeds.
    /// </summary>
    public async Task SaveAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return;
        }

        IsBusy = true;
        StatusText = "Saving bookmark...";

        try
        {
            await _bookmarkCommandService.CreateBookmarkAsync(new CreateBookmarkInput(Url, Title, Summary), cancellationToken);
            StatusText = "Bookmark created successfully.";

            // Use shell back navigation so the list page refresh logic can re-run naturally on re-entry.
            await _navigationService.GoToAsync("..");
        }
        catch (OperationCanceledException)
        {
            StatusText = "Bookmark creation was canceled.";
        }
        catch (Exception)
        {
            StatusText = "Bookmark creation failed.";
        }
        finally
        {
            IsBusy = false;
        }
    }
}
