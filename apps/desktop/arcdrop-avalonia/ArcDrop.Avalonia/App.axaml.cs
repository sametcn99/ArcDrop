using System;
using System.Net.Http;
using ArcDrop.Avalonia.Services;
using ArcDrop.Avalonia.ViewModels;
using ArcDrop.Avalonia.ViewModels.Pages;
using ArcDrop.Avalonia.Views;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.DependencyInjection;

namespace ArcDrop.Avalonia;

public partial class App : global::Avalonia.Application
{
    private IServiceProvider _services = CreateServices();

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            // All API data requires an admin bearer token, so unsigned sessions land on the login flow first.
            if (_services.GetRequiredService<IApiAuthSession>().IsAuthenticated)
            {
                ShowMainWindow(desktop);
            }
            else
            {
                ShowLoginWindow(desktop);
            }
        }

        base.OnFrameworkInitializationCompleted();
    }

    private void ShowLoginWindow(IClassicDesktopStyleApplicationLifetime desktop)
    {
        var loginViewModel = _services.GetRequiredService<LoginViewModel>();
        var loginWindow = new LoginWindow(loginViewModel);
        loginViewModel.LoginSucceeded += (_, _) => ShowMainWindow(desktop, loginWindow);

        desktop.MainWindow = loginWindow;
        loginWindow.Show();
    }

    private void ShowMainWindow(IClassicDesktopStyleApplicationLifetime desktop, Window? previousWindow = null)
    {
        var mainViewModel = _services.GetRequiredService<MainViewModel>();
        var mainWindow = new MainWindow(mainViewModel);
        mainWindow.Closed += (_, _) =>
        {
            if (desktop.MainWindow == mainWindow)
            {
                desktop.Shutdown();
            }
        };
        mainViewModel.SignOutRequested += (_, _) =>
        {
            ShowLoginWindow(desktop);
            mainWindow.Close();
        };

        desktop.MainWindow = mainWindow;
        mainWindow.Show();
        _ = mainViewModel.InitializeAsync();

        previousWindow?.Close();
    }

    /// <summary>
    /// Central DI composition mirroring the MAUI registration style so both clients stay symmetric.
    /// </summary>
    private static IServiceProvider CreateServices()
    {
        var services = new ServiceCollection();

        var configuredApiBaseUrl = Environment.GetEnvironmentVariable("ARCDROP_Api__BaseUrl");
        var apiBaseUri = Uri.TryCreate(configuredApiBaseUrl, UriKind.Absolute, out var parsedApiBaseUri)
            ? parsedApiBaseUri
            : new Uri("http://localhost:5237/", UriKind.Absolute);

        services.AddSingleton(apiBaseUri);
        services.AddSingleton<IApiAuthSession, FileApiAuthSession>();
        services.AddSingleton<AuthorizedHttpMessageHandler>();
        services.AddSingleton(sp =>
        {
            var handler = sp.GetRequiredService<AuthorizedHttpMessageHandler>();
            handler.InnerHandler = new HttpClientHandler();
            return new HttpClient(handler)
            {
                BaseAddress = sp.GetRequiredService<Uri>()
            };
        });
        services.AddSingleton<IApiAuthService, ApiAuthService>();
        services.AddSingleton<ApiBookmarkClient>();
        services.AddSingleton<ApiCollectionClient>();
        services.AddSingleton<INavigationService, NavigationService>();

        services.AddSingleton<LoginViewModel>();
        services.AddSingleton<MainViewModel>();
        services.AddSingleton<DashboardViewModel>();
        services.AddSingleton<BookmarkListViewModel>();
        services.AddSingleton<BookmarkEditViewModel>();
        services.AddSingleton<SettingsViewModel>();

        return services.BuildServiceProvider();
    }
}
