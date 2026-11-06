using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

public partial class SettingsPage : ContentPage
{
    private readonly SettingsViewModel _viewModel;

    /// <summary>
    /// Binds the settings view to its view model resolved from dependency injection.
    /// </summary>
    public SettingsPage(SettingsViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = viewModel;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _viewModel.RefreshSession();
    }
}
