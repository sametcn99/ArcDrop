using System.Collections.ObjectModel;
using System.Windows.Input;
using ArcDrop.Avalonia.Services;

namespace ArcDrop.Avalonia.ViewModels.Pages;

/// <summary>
/// One selectable collection row with checkbox state for membership editing.
/// </summary>
public sealed class CollectionCheckViewModel : ViewModelBase
{
    private bool _isChecked;

    public CollectionCheckViewModel(CollectionDto collection, int depth, bool isChecked)
    {
        Collection = collection;
        Depth = depth;
        _isChecked = isChecked;
    }

    public CollectionDto Collection { get; }

    public int Depth { get; }

    public string Name => new string(' ', Depth * 2) + Collection.Name;

    public bool IsChecked
    {
        get => _isChecked;
        set => SetProperty(ref _isChecked, value);
    }
}

/// <summary>
/// Bookmark create/edit editor covering title, URL, summary, tags, and collection membership.
/// </summary>
public sealed class BookmarkEditViewModel : ViewModelBase
{
    private readonly ApiBookmarkClient _bookmarkClient;
    private readonly ApiCollectionClient _collectionClient;
    private readonly INavigationService _navigation;
    private Guid? _editingBookmarkId;
    private string _title = string.Empty;
    private string _url = string.Empty;
    private string _summary = string.Empty;
    private string _tagsText = string.Empty;
    private bool _isBusy;
    private string? _errorText;

    public BookmarkEditViewModel(
        ApiBookmarkClient bookmarkClient,
        ApiCollectionClient collectionClient,
        INavigationService navigation)
    {
        _bookmarkClient = bookmarkClient;
        _collectionClient = collectionClient;
        _navigation = navigation;
        SaveCommand = new Command(async () => await SaveAsync(), () => !IsBusy);
        CancelCommand = new Command(() => _navigation.ShowBookmarks());
    }

    public ObservableCollection<CollectionCheckViewModel> Collections { get; } = [];

    public bool IsEditMode => _editingBookmarkId is not null;

    public string HeaderText => IsEditMode ? "Edit Bookmark" : "New Bookmark";

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

    public string Summary
    {
        get => _summary;
        set => SetProperty(ref _summary, value);
    }

    /// <summary>
    /// Comma-separated tag entry; splitting and trimming happen on save.
    /// </summary>
    public string TagsText
    {
        get => _tagsText;
        set => SetProperty(ref _tagsText, value);
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

    public ICommand SaveCommand { get; }

    public ICommand CancelCommand { get; }

    /// <summary>
    /// Switches the editor target; null prepares create mode.
    /// </summary>
    public void Prepare(Guid? bookmarkId)
    {
        _editingBookmarkId = bookmarkId;
        OnPropertyChanged(nameof(IsEditMode));
        OnPropertyChanged(nameof(HeaderText));
    }

    /// <summary>
    /// Loads the edited bookmark detail and collection picker state.
    /// </summary>
    public async Task LoadAsync()
    {
        IsBusy = true;
        ErrorText = null;

        try
        {
            var collections = await _collectionClient.GetCollectionsAsync(CancellationToken.None);

            var selectedIds = new HashSet<Guid>();
            if (_editingBookmarkId is { } bookmarkId)
            {
                var detail = await _bookmarkClient.GetBookmarkByIdAsync(bookmarkId, CancellationToken.None);
                if (detail is null)
                {
                    ErrorText = "Bookmark was not found.";
                    return;
                }

                Title = detail.Title;
                Url = detail.Url;
                Summary = detail.Summary ?? string.Empty;
                TagsText = detail.Tags is null ? string.Empty : string.Join(", ", detail.Tags);
                selectedIds.UnionWith(detail.CollectionIds ?? []);
            }
            else
            {
                Title = string.Empty;
                Url = string.Empty;
                Summary = string.Empty;
                TagsText = string.Empty;
            }

            Collections.Clear();
            foreach (var collection in collections)
            {
                var depth = ApiCollectionClient.CollectionDepth(collections, collection.Id);
                Collections.Add(new CollectionCheckViewModel(collection, depth, selectedIds.Contains(collection.Id)));
            }
        }
        catch (Exception)
        {
            ErrorText = "Could not load editor data. Verify the API is running and the session is valid.";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task SaveAsync()
    {
        var trimmedTitle = Title.Trim();
        var trimmedUrl = Url.Trim();

        if (string.IsNullOrWhiteSpace(trimmedTitle))
        {
            ErrorText = "Title is required.";
            return;
        }

        if (!Uri.TryCreate(trimmedUrl, UriKind.Absolute, out _))
        {
            ErrorText = "A valid absolute URL is required.";
            return;
        }

        IsBusy = true;
        ErrorText = null;

        try
        {
            var tags = TagsText
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var collectionIds = Collections
                .Where(item => item.IsChecked)
                .Select(item => item.Collection.Id)
                .ToList();

            var summary = string.IsNullOrWhiteSpace(Summary) ? null : Summary.Trim();

            if (_editingBookmarkId is { } bookmarkId)
            {
                await _bookmarkClient.UpdateBookmarkAsync(
                    new Application.Bookmarks.UpdateBookmarkInput(bookmarkId, trimmedUrl, trimmedTitle, summary, tags),
                    collectionIds,
                    CancellationToken.None);
            }
            else
            {
                await _bookmarkClient.CreateBookmarkAsync(
                    new Application.Bookmarks.CreateBookmarkInput(trimmedUrl, trimmedTitle, summary, tags),
                    collectionIds,
                    CancellationToken.None);
            }

            _navigation.ShowBookmarks();
        }
        catch (Exception)
        {
            ErrorText = IsEditMode ? "Bookmark update failed." : "Bookmark creation failed.";
        }
        finally
        {
            IsBusy = false;
        }
    }
}
