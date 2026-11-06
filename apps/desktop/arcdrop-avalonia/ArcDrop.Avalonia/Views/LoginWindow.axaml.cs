using ArcDrop.Avalonia.ViewModels;
using Avalonia.Controls;

namespace ArcDrop.Avalonia.Views;

/// <summary>
/// Fixed-admin sign-in window for the Linux desktop client.
/// </summary>
public partial class LoginWindow : Window
{
    public LoginWindow()
    {
        InitializeComponent();
    }

    public LoginWindow(LoginViewModel viewModel)
        : this()
    {
        DataContext = viewModel;
    }
}
