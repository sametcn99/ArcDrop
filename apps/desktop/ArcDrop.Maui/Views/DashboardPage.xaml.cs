using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

public partial class DashboardPage : ContentPage
{
    /// <summary>
    /// Binds the dashboard view to its view model resolved from dependency injection.
    /// </summary>
    public DashboardPage(DashboardViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }
}
