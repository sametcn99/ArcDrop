using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

public partial class BookmarkDetailPage : ContentPage, IQueryAttributable
{
    private readonly BookmarkDetailViewModel _viewModel;

    /// <summary>
    /// Binds bookmark detail edit workflows to MVVM state and commands.
    /// </summary>
    public BookmarkDetailPage(BookmarkDetailViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
    }

    /// <summary>
    /// Receives route query parameters and loads target bookmark detail.
    /// </summary>
    public async void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (!query.TryGetValue("bookmarkId", out var bookmarkIdRaw))
        {
            return;
        }

        var parsed = bookmarkIdRaw switch
        {
            Guid guid => guid,
            string text when Guid.TryParse(text, out var guid) => guid,
            _ => Guid.Empty
        };

        if (parsed == Guid.Empty)
        {
            return;
        }

        await _viewModel.LoadAsync(parsed);
    }
}
