namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Represents baseline settings page state for provider and endpoint configuration entry points.
/// Detailed settings workflows will be added in later tasks.
/// </summary>
public sealed class SettingsViewModel : ViewModelBase
{
    private string _title = "Settings";
    private string _description = "Provider, endpoint, and client preferences will be configured here.";

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
}
