using ArcDrop.Avalonia.ViewModels;
using Avalonia.Controls;

namespace ArcDrop.Avalonia.Views;

/// <summary>
/// Authenticated workspace shell hosting sidebar navigation and the active page.
/// </summary>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
    }

    public MainWindow(MainViewModel viewModel)
        : this()
    {
        DataContext = viewModel;
    }
}
