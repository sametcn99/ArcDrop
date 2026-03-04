namespace ArcDrop.Maui;

public partial class App : Microsoft.Maui.Controls.Application
{
	private readonly AppShell _appShell;

	/// <summary>
	/// Uses DI for root shell creation so view and service dependencies remain centrally configured.
	/// </summary>
	/// <param name="appShell">Root shell resolved from the MAUI service provider.</param>
	public App(AppShell appShell)
	{
		InitializeComponent();
		_appShell = appShell;
	}

	protected override Window CreateWindow(IActivationState? activationState)
	{
		return new Window(_appShell);
	}
}