using ArcDrop.Maui.ViewModels;

namespace ArcDrop.Maui.Views;

/// <summary>
/// Fixed-admin sign-in surface for the desktop client.
/// </summary>
public partial class LoginPage : ContentPage
{
    public LoginPage(LoginViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;

        // After a successful sign-in the workspace shell becomes the active flow again.
        viewModel.LoginSucceeded += async (_, _) =>
        {
            await Shell.Current.GoToAsync("//DashboardPage");
        };
    }
}
