using System.Windows.Input;
using ArcDrop.Maui.Services;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Represents desktop settings state: admin session status and sign-out actions.
/// Provider and endpoint preferences will join this surface in later tasks.
/// </summary>
public sealed class SettingsViewModel : ViewModelBase
{
    private readonly IApiAuthSession _authSession;
    private readonly IApiAuthService _authService;
    private string _title = "Settings";
    private string _description = "Review your admin session and connection state.";
    private string _sessionStatusText = "Loading session...";

    public SettingsViewModel(IApiAuthSession authSession, IApiAuthService authService)
    {
        _authSession = authSession;
        _authService = authService;
        SignOutCommand = new Command(async () => await SignOutAsync());
        RefreshSessionCommand = new Command(RefreshSession);
    }

    public string Title
    {
        get => _title;
        private set => SetProperty(ref _title, value);
    }

    public string Description
    {
        get => _description;
        private set => SetProperty(ref _description, value);
    }

    public string SessionStatusText
    {
        get => _sessionStatusText;
        private set => SetProperty(ref _sessionStatusText, value);
    }

    public ICommand SignOutCommand { get; }

    public ICommand RefreshSessionCommand { get; }

    public void RefreshSession()
    {
        if (!_authSession.IsAuthenticated)
        {
            SessionStatusText = "Not signed in. Restart the app or sign in from the login screen.";
            return;
        }

        var expiresText = _authSession.ExpiresAtUtc?.ToLocalTime().ToString("g") ?? "N/A";
        SessionStatusText = $"Signed in as {_authSession.Username ?? "admin"}. Session expires {expiresText}.";
    }

    private async Task SignOutAsync()
    {
        await _authService.LogoutAsync();
        SessionStatusText = "Signed out. Restart the app or sign in from the login screen.";
        await Shell.Current.GoToAsync(nameof(Views.LoginPage));
    }
}
