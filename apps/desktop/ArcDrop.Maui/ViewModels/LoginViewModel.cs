using System.Windows.Input;
using ArcDrop.Maui.Services;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Drives the desktop fixed-admin sign-in flow against the ArcDrop API.
/// </summary>
public sealed class LoginViewModel : ViewModelBase
{
    private readonly IApiAuthService _authService;
    private string _username = string.Empty;
    private string _password = string.Empty;
    private string? _errorMessage;
    private bool _isBusy;

    public LoginViewModel(IApiAuthService authService)
    {
        _authService = authService;
        LoginCommand = new Command(async () => await LoginAsync(), () => !IsBusy);
    }

    public string Username
    {
        get => _username;
        set => SetProperty(ref _username, value);
    }

    public string Password
    {
        get => _password;
        set => SetProperty(ref _password, value);
    }

    public string? ErrorMessage
    {
        get => _errorMessage;
        private set
        {
            if (SetProperty(ref _errorMessage, value))
            {
                OnPropertyChanged(nameof(HasError));
            }
        }
    }

    /// <summary>
    /// Convenience projection for XAML visibility binding without a value converter.
    /// </summary>
    public bool HasError => !string.IsNullOrWhiteSpace(_errorMessage);

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                (LoginCommand as Command)?.ChangeCanExecute();
            }
        }
    }

    public ICommand LoginCommand { get; }

    public event EventHandler? LoginSucceeded;

    private async Task LoginAsync()
    {
        IsBusy = true;
        ErrorMessage = null;

        try
        {
            var error = await _authService.LoginAsync(Username, Password, CancellationToken.None);
            if (error is not null)
            {
                ErrorMessage = error;
                return;
            }

            LoginSucceeded?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception)
        {
            ErrorMessage = "Could not reach the ArcDrop API. Verify the server is running.";
        }
        finally
        {
            IsBusy = false;
        }
    }
}
