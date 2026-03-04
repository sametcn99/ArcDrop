using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

public partial class CreateBookmarkPage : ContentPage
{
    /// <summary>
    /// Binds add-bookmark page to MVVM create workflow state.
    /// </summary>
    public CreateBookmarkPage(CreateBookmarkViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
