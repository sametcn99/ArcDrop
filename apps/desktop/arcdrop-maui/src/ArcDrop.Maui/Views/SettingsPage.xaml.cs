using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

public partial class SettingsPage : ContentPage
{
    /// <summary>
    /// Binds the settings view to its view model resolved from dependency injection.
    /// </summary>
    public SettingsPage(SettingsViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
