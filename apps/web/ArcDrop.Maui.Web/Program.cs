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

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddHttpContextAccessor();

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

var configuredApiBaseUrl = Environment.GetEnvironmentVariable("ARCDROP_Api__BaseUrl")
    ?? builder.Configuration["ArcDropApi:BaseUrl"]
    ?? "http://localhost:8080/";

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

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();

static string BuildLoginRedirect(string errorCode, string? returnUrl)
{
    var safeReturnUrl = AuthRoutePolicy.ResolveSafeReturnUrl(returnUrl);
    return $"/auth/login?error={Uri.EscapeDataString(errorCode)}&returnUrl={Uri.EscapeDataString(safeReturnUrl)}";
}
