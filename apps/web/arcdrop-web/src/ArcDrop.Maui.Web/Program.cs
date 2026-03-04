using ArcDrop.Web.Components;
using ArcDrop.Web.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

// Keep the auth session scoped to each Blazor circuit so tokens are not shared across users.
builder.Services.AddScoped<AuthSessionState>();

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

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
