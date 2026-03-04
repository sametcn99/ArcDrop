namespace ArcDrop.Maui;

public partial class AppShell : Shell
{
	/// <summary>
	/// Registers global shell routes required by command-driven MVVM navigation.
	/// </summary>
	public AppShell()
	{
		InitializeComponent();
		Routing.RegisterRoute(nameof(Views.SettingsPage), typeof(Views.SettingsPage));
		Routing.RegisterRoute(nameof(Views.BookmarkListPage), typeof(Views.BookmarkListPage));
		Routing.RegisterRoute(nameof(Views.BookmarkDetailPage), typeof(Views.BookmarkDetailPage));
		Routing.RegisterRoute(nameof(Views.CreateBookmarkPage), typeof(Views.CreateBookmarkPage));
	}
}
