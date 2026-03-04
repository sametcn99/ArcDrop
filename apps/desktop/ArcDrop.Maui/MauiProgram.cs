using Microsoft.Extensions.Logging;
using ArcDrop.Application.Bookmarks;
using ArcDrop.Maui.Services;
using ArcDrop.Maui.ViewModels;
using ArcDrop.Maui.Views;

namespace ArcDrop.Maui;

public static class MauiProgram
{
    public static MauiApp CreateMauiApp()
    {
        var builder = MauiApp.CreateBuilder();
        builder
            .UseMauiApp<App>()
            .ConfigureFonts(fonts =>
            {
                fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
                fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
            });

        // Register presentation and navigation dependencies explicitly so MVVM bindings remain
        // constructor-driven and testable without runtime service location.
        builder.Services.AddSingleton<INavigationService, ShellNavigationService>();

        // Prefer API-backed bookmark queries while preserving seed fallback for offline or unavailable backend states.
        var configuredApiBaseUrl = Environment.GetEnvironmentVariable("ARCDROP_Api__BaseUrl");
        var apiBaseUri = Uri.TryCreate(configuredApiBaseUrl, UriKind.Absolute, out var parsedApiBaseUri)
            ? parsedApiBaseUri
            : new Uri("http://localhost:5000/", UriKind.Absolute);

        builder.Services.AddSingleton(apiBaseUri);
        builder.Services.AddSingleton(sp => new HttpClient
        {
            BaseAddress = sp.GetRequiredService<Uri>()
        });

        builder.Services.AddSingleton<SeedBookmarkQueryService>();
        builder.Services.AddSingleton<ApiBookmarkQueryService>();
        builder.Services.AddSingleton<IBookmarkQueryService, ResilientBookmarkQueryService>();
        builder.Services.AddSingleton<IBookmarkCommandService, ApiBookmarkCommandService>();
        builder.Services.AddSingleton<AppShell>();
        builder.Services.AddTransient<DashboardViewModel>();
        builder.Services.AddTransient<BookmarkListViewModel>();
        builder.Services.AddTransient<BookmarkDetailViewModel>();
        builder.Services.AddTransient<CreateBookmarkViewModel>();
        builder.Services.AddTransient<SettingsViewModel>();
        builder.Services.AddTransient<DashboardPage>();
        builder.Services.AddTransient<BookmarkListPage>();
        builder.Services.AddTransient<BookmarkDetailPage>();
        builder.Services.AddTransient<CreateBookmarkPage>();
        builder.Services.AddTransient<SettingsPage>();

#if DEBUG
        builder.Logging.AddDebug();
#endif

        return builder.Build();
    }
}
