using ArcDrop.Api.Configuration;
using ArcDrop.Api.Endpoints;
using ArcDrop.Api.OpenApi;
using ArcDrop.Application.Ai;
using ArcDrop.Application.Authentication;
using ArcDrop.Infrastructure.DependencyInjection;
using ArcDrop.Infrastructure.Persistence;
using ArcDrop.Infrastructure.Security;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// Keep environment bootstrap concerns outside Program so startup remains a composition root.
EnvironmentConfigurationBootstrapper.Bootstrap(builder.Configuration);
EnvironmentConfigurationBootstrapper.TryApplyPostgresLocalFallback(builder.Configuration);

builder.Services
    .AddOptions<AdminBootstrapOptions>()
    .Bind(builder.Configuration.GetSection(AdminBootstrapOptions.SectionName))
    .ValidateDataAnnotations()
    .Validate(
        options => !string.IsNullOrWhiteSpace(options.Username) && !string.IsNullOrWhiteSpace(options.Password),
        "Admin bootstrap credentials must define non-empty username and password values.")
    .ValidateOnStart();

builder.Services
    .AddOptions<AdminCredentialPolicyOptions>()
    .Bind(builder.Configuration.GetSection(AdminCredentialPolicyOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services
    .AddOptions<JwtOptions>()
    .Bind(builder.Configuration.GetSection(JwtOptions.SectionName))
    .ValidateDataAnnotations()
    .Validate(
        options => !string.IsNullOrWhiteSpace(options.SigningKey) && options.SigningKey.Length >= 32,
        "JWT signing key must be at least 32 characters.")
    .ValidateOnStart();

var jwtOptions = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
    ?? throw new InvalidOperationException("JWT configuration section is missing.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SigningKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30)
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddDataProtection();
builder.Services.AddSingleton<IAdminTokenService>(_ => new AdminTokenService(jwtOptions));
builder.Services.AddSingleton<IAiProviderSecretProtector, AiProviderSecretProtector>();
builder.Services.AddSingleton<IAdminAuthenticationService, AdminAuthenticationService>();
builder.Services.AddSingleton<IOrganizationSuggestionService, DeterministicOrganizationSuggestionService>();
builder.Services.AddSingleton<IAdminCredentialService>(serviceProvider =>
{
    var adminOptions = serviceProvider.GetRequiredService<IOptions<AdminBootstrapOptions>>().Value;
    var credentialPolicy = serviceProvider.GetRequiredService<IOptions<AdminCredentialPolicyOptions>>().Value;

    return new InMemoryAdminCredentialService(adminOptions.Username, adminOptions.Password, credentialPolicy);
});

builder.Services.AddArcDropApiDocumentation();
builder.Services.AddArcDropInfrastructure(builder.Configuration);

var app = builder.Build();

if (!OpenApiBuildTimeExecutionDetector.IsActive())
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
    dbContext.Database.Migrate();
}

app.UseAuthentication();
app.UseAuthorization();

app.MapArcDropApiDocumentation();

// Register endpoint modules after middleware setup to keep route wiring centralized and auditable.
app.MapArcDropEndpoints();

app.Run();

// Expose the implicit Program type for WebApplicationFactory integration tests.
public partial class Program;
