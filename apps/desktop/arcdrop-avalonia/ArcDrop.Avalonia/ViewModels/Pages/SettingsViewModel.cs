using System.Windows.Input;
using ArcDrop.Avalonia.Services;

namespace ArcDrop.Avalonia.ViewModels.Pages;

/// <summary>
/// Desktop settings page: admin session status, API endpoint, and sign-out.
/// </summary>
public sealed class SettingsViewModel : ViewModelBase
{
    private readonly IApiAuthSession _authSession;
    private readonly IApiAuthService _authService;
    private readonly INavigationService _navigation;
    private readonly Uri _apiBaseUri;
    private string _sessionStatusText = "Loading session...";

    public SettingsViewModel(IApiAuthSession authSession, IApiAuthService authService, INavigationService navigation, Uri apiBaseUri)
    {
        _authService = authService;
        _authSession = authSession;
        _navigation = navigation;
        _apiBaseUri = apiBaseUri;
        SignOutCommand = new Command(() => SignOut());
    }

    public string SessionStatusText
    {
        get => _sessionStatusText;
        private set => SetProperty(ref _sessionStatusText, value);
    }

    public string ApiBaseUrl => _apiBaseUri.ToString();

    public ICommand SignOutCommand { get; }

    /// <summary>
    /// Refreshes session status projections for display.
    /// </summary>
    public void Refresh()
    {
        if (!_authSession.IsAuthenticated)
        {
            SessionStatusText = "Not signed in. Sign in from the login window to continue.";
            return;
        }

        var expiresText = _authSession.ExpiresAtUtc?.ToLocalTime().ToString("g") ?? "N/A";
        SessionStatusText = $"Signed in as {_authSession.Username ?? "admin"}. Session expires {expiresText}.";
    }

    private void SignOut()
    {
        _authService.Logout();
        _navigation.RequestSignOut();
    }
}
