using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

public partial class BookmarkListPage : ContentPage
{
    private readonly BookmarkListViewModel _viewModel;

    /// <summary>
    /// Binds bookmark list view state to MVVM query workflows.
    /// </summary>
    public BookmarkListPage(BookmarkListViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
    }

    /// <summary>
    /// Loads initial list data when page becomes visible so first render is meaningful.
    /// </summary>
    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_viewModel.Items.Count == 0)
        {
            await _viewModel.LoadBookmarksAsync();
        }
    }
}
