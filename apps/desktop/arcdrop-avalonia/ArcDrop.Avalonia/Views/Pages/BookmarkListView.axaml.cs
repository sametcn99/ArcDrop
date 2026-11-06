using Avalonia.Controls;
using Avalonia.Input;
using ArcDrop.Avalonia.ViewModels;
using ArcDrop.Avalonia.ViewModels.Pages;

namespace ArcDrop.Avalonia.Views.Pages;

/// <summary>
/// Bookmark list page with server-side search and row actions.
/// </summary>
public partial class BookmarkListView : UserControl
{
    public BookmarkListView()
    {
        InitializeComponent();
    }

    /// <summary>
    /// Lets Enter in the search box trigger the search command directly.
    /// </summary>
    private void OnSearchKeyDown(object? sender, KeyEventArgs args)
    {
        if (args.Key == Key.Enter && DataContext is BookmarkListViewModel viewModel)
        {
            if (viewModel.SearchCommand.CanExecute(null))
            {
                viewModel.SearchCommand.Execute(null);
            }
        }
    }
}
