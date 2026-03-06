using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using ArcDrop.Web.Components;
using ArcDrop.Web.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;

LoadDotEnvValues();

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddHttpContextAccessor();
builder.Services.AddCascadingAuthenticationState();
builder.Services.AddMemoryCache(options => options.SizeLimit = 20 * 1024 * 1024);

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "arcdrop.web.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
        options.SlidingExpiration = false;
        options.LoginPath = "/auth/login";
        options.AccessDeniedPath = "/auth/login";
    });

builder.Services.AddAuthorization();

var configuredApiBaseUrl =
    Environment.GetEnvironmentVariable("ARCDROP_API_BASE_URL")
    ?? Environment.GetEnvironmentVariable("ARCDROP_Api__BaseUrl")
    ?? BuildApiBaseUrlFromPort(Environment.GetEnvironmentVariable("ARCDROP_API_PORT"));

var apiBaseUri = Uri.TryCreate(configuredApiBaseUrl, UriKind.Absolute, out var parsedApiBaseUri)
    ? parsedApiBaseUri
    : new Uri("http://localhost:8080/", UriKind.Absolute);

builder.Services.AddHttpClient<IArcDropApiClient, ArcDropApiClient>(httpClient =>
{
    httpClient.BaseAddress = apiBaseUri;
});

builder.Services.AddHttpClient("ArcDrop.ApiAuth", httpClient =>
{
    httpClient.BaseAddress = apiBaseUri;
});

builder.Services.AddHttpClient<IBookmarkIconService, BookmarkIconService>(httpClient =>
{
    httpClient.Timeout = TimeSpan.FromSeconds(8);
    httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("ArcDrop.Web/1.0 (+bookmark-icon-cache)");
})
.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    AllowAutoRedirect = false,
    AutomaticDecompression = DecompressionMethods.Deflate | DecompressionMethods.GZip
});

builder.Services.AddHttpClient<IBookmarkMetadataService, BookmarkMetadataService>(httpClient =>
{
    httpClient.Timeout = TimeSpan.FromSeconds(8);
    httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("ArcDrop.Web/1.0 (+bookmark-metadata-cache)");
})
.ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
{
    AllowAutoRedirect = false,
    AutomaticDecompression = DecompressionMethods.Deflate | DecompressionMethods.GZip
});

builder.Services.AddSingleton<ISharedStateService, SharedStateService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.UseAntiforgery();

app.MapPost("/auth/session/login", async Task<IResult> (
    [FromForm] LoginRequest request,
    [FromForm] string? returnUrl,
    IHttpClientFactory httpClientFactory,
    HttpContext httpContext,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
    {
        var redirectUrl = BuildLoginRedirect("missing_credentials", returnUrl);
        return Results.LocalRedirect(redirectUrl);
    }

    var authClient = httpClientFactory.CreateClient("ArcDrop.ApiAuth");
    using var loginResponse = await authClient.PostAsJsonAsync("api/auth/login", request, cancellationToken);

    if (loginResponse.StatusCode == HttpStatusCode.Unauthorized)
    {
        var redirectUrl = BuildLoginRedirect("invalid_credentials", returnUrl);
        return Results.LocalRedirect(redirectUrl);
    }

    if (!loginResponse.IsSuccessStatusCode)
    {
        var redirectUrl = BuildLoginRedirect("auth_service_error", returnUrl);
        return Results.LocalRedirect(redirectUrl);
    }

    var loginPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>(cancellationToken: cancellationToken);
    if (loginPayload is null || string.IsNullOrWhiteSpace(loginPayload.AccessToken) || loginPayload.ExpiresAtUtc <= DateTimeOffset.UtcNow)
    {
        var redirectUrl = BuildLoginRedirect("invalid_auth_payload", returnUrl);
        return Results.LocalRedirect(redirectUrl);
    }

    using var profileRequest = new HttpRequestMessage(HttpMethod.Get, "api/auth/me");
    profileRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", loginPayload.AccessToken);
    using var profileResponse = await authClient.SendAsync(profileRequest, cancellationToken);

    var username = request.Username;
    if (profileResponse.IsSuccessStatusCode)
    {
        var profilePayload = await profileResponse.Content.ReadFromJsonAsync<CurrentAdminResponse>(cancellationToken: cancellationToken);
        if (!string.IsNullOrWhiteSpace(profilePayload?.Username))
        {
            username = profilePayload.Username;
        }
    }

    var claims = new List<Claim>
    {
        new(ClaimTypes.Name, username),
        new("arcdrop:access_token", loginPayload.AccessToken),
        new("arcdrop:expires_at_unix", loginPayload.ExpiresAtUtc.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture))
    };

    var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
    var principal = new ClaimsPrincipal(identity);

    var authProperties = new AuthenticationProperties
    {
        IsPersistent = true,
        IssuedUtc = DateTimeOffset.UtcNow,
        ExpiresUtc = loginPayload.ExpiresAtUtc,
        AllowRefresh = false
    };

    await httpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal, authProperties);

    var safeReturnUrl = AuthRoutePolicy.ResolveSafeReturnUrl(returnUrl);
    return Results.LocalRedirect(safeReturnUrl);
});

app.MapPost("/auth/session/logout", async Task<IResult> (HttpContext httpContext) =>
{
    await httpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.LocalRedirect("/auth/login");
});

app.MapGet("/bookmark-icons", async Task<IResult> (
    [FromQuery] string? url,
    IBookmarkIconService bookmarkIconService,
    HttpContext httpContext,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(url))
    {
        return Results.BadRequest();
    }

    // Cache both image hits and misses in the browser so card refreshes stay inexpensive.
    var payload = await bookmarkIconService.GetIconAsync(url, cancellationToken);
    httpContext.Response.Headers[Microsoft.Net.Http.Headers.HeaderNames.CacheControl] = payload is null
        ? "public,max-age=1800"
        : "public,max-age=43200";

    return payload is null
        ? Results.NoContent()
        : Results.File(payload.Content, payload.ContentType);
});

app.MapGet("/bookmark-metadata", async Task<IResult> (
    [FromQuery] string? url,
    IBookmarkMetadataService bookmarkMetadataService,
    HttpContext httpContext,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(url))
    {
        return Results.BadRequest();
    }

    // Short browser caching keeps URL typing responsive while preserving freshness for edited pages.
    var payload = await bookmarkMetadataService.GetMetadataAsync(url, cancellationToken);
    httpContext.Response.Headers[Microsoft.Net.Http.Headers.HeaderNames.CacheControl] = payload is null
        ? "public,max-age=600"
        : "public,max-age=3600";

    return payload is null
        ? Results.NoContent()
        : Results.Ok(new BookmarkMetadataResponse(payload.Title, payload.Description));
});

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();

static string BuildLoginRedirect(string errorCode, string? returnUrl)
{
    var safeReturnUrl = AuthRoutePolicy.ResolveSafeReturnUrl(returnUrl);
    return $"/auth/login?error={Uri.EscapeDataString(errorCode)}&returnUrl={Uri.EscapeDataString(safeReturnUrl)}";
}

static string BuildApiBaseUrlFromPort(string? apiPort)
{
    if (!int.TryParse(apiPort, out var parsedPort) || parsedPort <= 0)
    {
        return "http://localhost:8080/";
    }

    return $"http://localhost:{parsedPort}/";
}

static void LoadDotEnvValues()
{
    foreach (var envFilePath in EnumerateDotEnvCandidates())
    {
        if (!File.Exists(envFilePath))
        {
            continue;
        }

        foreach (var rawLine in File.ReadLines(envFilePath))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }

            var separatorIndex = line.IndexOf('=');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var key = line[..separatorIndex].Trim();
            var value = line[(separatorIndex + 1)..].Trim();

            // Do not overwrite explicitly provided process-level values.
            if (!string.IsNullOrWhiteSpace(key) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        break;
    }
}

static IEnumerable<string> EnumerateDotEnvCandidates()
{
    var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    var currentDirectory = new DirectoryInfo(Directory.GetCurrentDirectory());

    while (currentDirectory is not null)
    {
        var localEnv = Path.Combine(currentDirectory.FullName, ".env");
        if (visited.Add(localEnv))
        {
            yield return localEnv;
        }

        var repoOpsEnv = Path.Combine(currentDirectory.FullName, "ops", "docker", ".env");
        if (visited.Add(repoOpsEnv))
        {
            yield return repoOpsEnv;
        }

        currentDirectory = currentDirectory.Parent;
    }
}

internal sealed record BookmarkMetadataResponse(string Title, string? Description);
