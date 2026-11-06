namespace ArcDrop.Maui;

public partial class App : Microsoft.Maui.Controls.Application
{
    private readonly AppShell _appShell;
    private readonly Services.IApiAuthSession _authSession;

    /// <summary>
    /// Uses DI for root shell creation so view and service dependencies remain centrally configured.
    /// </summary>
    /// <param name="appShell">Root shell resolved from the MAUI service provider.</param>
    /// <param name="authSession">Admin API session used to gate the workspace behind sign-in.</param>
    public App(AppShell appShell, Services.IApiAuthSession authSession)
    {
        InitializeComponent();
        _appShell = appShell;
        _authSession = authSession;
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        var window = new Window(_appShell);

        // All API data requires an admin bearer token, so unsigned sessions land on the login flow first.
        window.Created += async (_, _) =>
        {
            if (!_authSession.IsAuthenticated)
            {
                await _appShell.GoToAsync(nameof(Views.LoginPage));
            }
        };

        return window;
    }
}