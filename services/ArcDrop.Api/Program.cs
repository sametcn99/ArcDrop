using ArcDrop.Api.Configuration;
using ArcDrop.Api.Contracts;
using ArcDrop.Api.Security;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.DependencyInjection;
using ArcDrop.Infrastructure.Persistence;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

LoadDotEnvValues();

var builder = WebApplication.CreateBuilder(args);

// Explicitly load ArcDrop-prefixed environment variables so self-host deployments can keep secrets
// outside source-controlled files. Example key mapping: ARCDROP_Admin__Username.
builder.Configuration.AddEnvironmentVariables(prefix: "ARCDROP_");

// Map flat ARCDROP_* environment keys from .env to typed options sections.
// This keeps secrets and deployment values outside appsettings while preserving existing option binding.
ApplyEnvBackedConfiguration(builder.Configuration);

var configuredConnectionString = builder.Configuration.GetConnectionString("ArcDropPostgres");
if (ShouldUsePostgresEnvironmentFallback(configuredConnectionString))
{
    // Use only ARCDROP_* PostgreSQL keys so debug and fallback read the same env names.
    var postgresDatabase = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_DB");
    var postgresUser = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_USER");
    var postgresPassword = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_PASSWORD");
    var postgresPort = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_PORT");

    // Local debugging may run API outside Docker while credentials still live in env files.
    // This fallback only activates when ArcDropPostgres is missing or still set to placeholder values.
    if (!string.IsNullOrWhiteSpace(postgresDatabase) &&
        !string.IsNullOrWhiteSpace(postgresUser) &&
        !string.IsNullOrWhiteSpace(postgresPassword))
    {
        var normalizedPort = int.TryParse(postgresPort, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedPort)
            ? parsedPort
            : 5432;

        var fallbackConnectionString =
            $"Host=localhost;Port={normalizedPort};Database={postgresDatabase};Username={postgresUser};Password={postgresPassword}";

        builder.Configuration["ConnectionStrings:ArcDropPostgres"] = fallbackConnectionString;
    }
}

// Bind fixed-admin bootstrap settings early and validate them at startup so configuration failures
// are detected before the API starts serving requests.
builder.Services
    .AddOptions<AdminBootstrapOptions>()
    .Bind(builder.Configuration.GetSection(AdminBootstrapOptions.SectionName))
    .ValidateDataAnnotations()
    .Validate(
        options => !string.IsNullOrWhiteSpace(options.Username) && !string.IsNullOrWhiteSpace(options.Password),
        "Admin bootstrap credentials must define non-empty username and password values.")
    .ValidateOnStart();

// Bind credential policy to enforce password complexity and reuse controls for rotation operations.
builder.Services
    .AddOptions<AdminCredentialPolicyOptions>()
    .Bind(builder.Configuration.GetSection(AdminCredentialPolicyOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

// Bind JWT options with startup validation so insecure token settings fail fast.
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
builder.Services.AddSingleton<IAdminCredentialService>(serviceProvider =>
{
    var adminOptions = serviceProvider.GetRequiredService<IOptions<AdminBootstrapOptions>>().Value;
    var credentialPolicy = serviceProvider.GetRequiredService<IOptions<AdminCredentialPolicyOptions>>().Value;

    return new InMemoryAdminCredentialService(adminOptions.Username, adminOptions.Password, credentialPolicy);
});

// Keep OpenAPI enabled for early API discovery and contract validation in development workflows.
builder.Services.AddOpenApi();
builder.Services.AddArcDropInfrastructure(builder.Configuration);

var app = builder.Build();

// Apply pending migrations at startup so API endpoints do not fail with missing-table errors
// when the database is provisioned but schema initialization has not been run yet.
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
    dbContext.Database.Migrate();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseAuthentication();
app.UseAuthorization();

// The root endpoint provides a lightweight readiness message for operators and CI smoke checks.
app.MapGet("/", () => Results.Ok(new
{
    Service = "ArcDrop API",
    Message = "ArcDrop API started successfully.",
    UtcTimestamp = DateTimeOffset.UtcNow
}));

// Health endpoint intentionally returns a compact payload that can be used by Docker health checks,
// deployment scripts, and integration tests without requiring downstream dependencies yet.
app.MapGet("/health", (IAdminCredentialService credentialService) =>
{
    var adminConfigurationDetected = credentialService.IsConfigured;

    return Results.Ok(new
    {
        Status = "Healthy",
        Service = "ArcDrop API",
        Environment = app.Environment.EnvironmentName,
        AdminConfigurationDetected = adminConfigurationDetected,
        UtcTimestamp = DateTimeOffset.UtcNow
    });
});

// Authentication endpoints provide fixed-admin login and token validation paths for v1 self-host deployments.
var authGroup = app.MapGroup("/api/auth");

authGroup.MapPost("/login", (
    LoginRequest request,
    IAdminCredentialService credentialService,
    IAdminTokenService tokenService) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.Username)] = ["Username is required."],
            [nameof(request.Password)] = ["Password is required."]
        });
    }

    var isCredentialValid = credentialService.ValidateCredentials(request.Username, request.Password);
    if (!isCredentialValid)
    {
        return Results.Unauthorized();
    }

    var (accessToken, expiresAtUtc) = tokenService.CreateAccessToken(credentialService.Username);
    return Results.Ok(new LoginResponse(accessToken, expiresAtUtc));
});

authGroup.MapGet("/me", [Authorize] (ClaimsPrincipal user) =>
{
    var username = user.Identity?.Name
        ?? user.FindFirstValue(ClaimTypes.Name)
        ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? user.FindFirstValue("unique_name")
        ?? "unknown";

    return Results.Ok(new CurrentAdminResponse(username, Authenticated: true));
});

authGroup.MapPost("/rotate-password", [Authorize(Roles = "Admin")] (
    RotateAdminPasswordRequest request,
    ClaimsPrincipal user,
    IAdminCredentialService credentialService) =>
{
    if (string.IsNullOrWhiteSpace(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.CurrentPassword)] = ["Current password is required."],
            [nameof(request.NewPassword)] = ["New password is required."]
        });
    }

    var username = user.FindFirstValue("unique_name")
        ?? user.Identity?.Name
        ?? credentialService.Username;

    var rotationResult = credentialService.TryRotatePassword(username, request.CurrentPassword, request.NewPassword);
    if (!rotationResult.Success)
    {
        var validationErrors = new Dictionary<string, string[]>
        {
            [nameof(request.NewPassword)] = [rotationResult.ValidationError ?? "Password rotation failed."]
        };

        if (rotationResult.ValidationError is "Current credentials are invalid.")
        {
            return Results.Unauthorized();
        }

        return Results.ValidationProblem(validationErrors);
    }

    return Results.NoContent();
});

var aiProviderGroup = app.MapGroup("/api/ai/providers").RequireAuthorization();
var aiGroup = app.MapGroup("/api/ai").RequireAuthorization();

const string ArcDropSystemPromptTemplate =
    "You are ArcDrop Organizer. Return deterministic, concise suggestions for bookmark organization. " +
    "Never include secrets. Use English-only outputs and keep results structured by operation type.";

// AI provider configuration endpoints store API keys as encrypted ciphertext and only expose masked previews.
aiProviderGroup.MapGet("/", async (ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
{
    var providers = await dbContext.AiProviderConfigs
        .AsNoTracking()
        .OrderByDescending(x => x.UpdatedAtUtc)
        .Select(x => new AiProviderConfigResponse(
            x.Id,
            x.ProviderName,
            x.ApiEndpoint,
            x.Model,
            HasApiKey: !string.IsNullOrWhiteSpace(x.ApiKeyCipherText),
            ApiKeyPreview: "****",
            x.CreatedAtUtc,
            x.UpdatedAtUtc))
        .ToListAsync(cancellationToken);

    return Results.Ok(providers);
});

aiProviderGroup.MapPost("/", async (
    UpsertAiProviderConfigRequest request,
    ArcDropDbContext dbContext,
    IAiProviderSecretProtector secretProtector,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.ProviderName) ||
        string.IsNullOrWhiteSpace(request.ApiEndpoint) ||
        string.IsNullOrWhiteSpace(request.Model) ||
        string.IsNullOrWhiteSpace(request.ApiKey))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.ProviderName)] = ["Provider name is required."],
            [nameof(request.ApiEndpoint)] = ["API endpoint is required."],
            [nameof(request.Model)] = ["Model is required."],
            [nameof(request.ApiKey)] = ["API key is required."]
        });
    }

    if (!Uri.TryCreate(request.ApiEndpoint, UriKind.Absolute, out _))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.ApiEndpoint)] = ["A valid absolute API endpoint is required."]
        });
    }

    var providerName = request.ProviderName.Trim();
    var existing = await dbContext.AiProviderConfigs
        .SingleOrDefaultAsync(x => x.ProviderName == providerName, cancellationToken);

    var utcNow = DateTimeOffset.UtcNow;
    var encryptedApiKey = secretProtector.Protect(request.ApiKey.Trim());

    if (existing is null)
    {
        var entity = new AiProviderConfig
        {
            Id = Guid.NewGuid(),
            ProviderName = providerName,
            ApiEndpoint = request.ApiEndpoint.Trim(),
            Model = request.Model.Trim(),
            ApiKeyCipherText = encryptedApiKey,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

        dbContext.AiProviderConfigs.Add(entity);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/ai/providers/{Uri.EscapeDataString(entity.ProviderName)}",
            new AiProviderConfigResponse(
                entity.Id,
                entity.ProviderName,
                entity.ApiEndpoint,
                entity.Model,
                HasApiKey: true,
                ApiKeyPreview: secretProtector.CreateMaskedPreview(request.ApiKey.Trim()),
                entity.CreatedAtUtc,
                entity.UpdatedAtUtc));
    }

    existing.ApiEndpoint = request.ApiEndpoint.Trim();
    existing.Model = request.Model.Trim();
    existing.ApiKeyCipherText = encryptedApiKey;
    existing.UpdatedAtUtc = utcNow;

    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.Ok(new AiProviderConfigResponse(
        existing.Id,
        existing.ProviderName,
        existing.ApiEndpoint,
        existing.Model,
        HasApiKey: true,
        ApiKeyPreview: secretProtector.CreateMaskedPreview(request.ApiKey.Trim()),
        existing.CreatedAtUtc,
        existing.UpdatedAtUtc));
});

aiProviderGroup.MapGet("/{providerName}", async (
    string providerName,
    ArcDropDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var normalizedName = providerName.Trim();
    var config = await dbContext.AiProviderConfigs
        .AsNoTracking()
        .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

    if (config is null)
    {
        return Results.NotFound();
    }

    return Results.Ok(new AiProviderConfigResponse(
        config.Id,
        config.ProviderName,
        config.ApiEndpoint,
        config.Model,
        HasApiKey: !string.IsNullOrWhiteSpace(config.ApiKeyCipherText),
        ApiKeyPreview: "****",
        config.CreatedAtUtc,
        config.UpdatedAtUtc));
});

// Update endpoint allows endpoint/model edits without forcing API key re-entry.
// If a new API key is provided, it is encrypted and replaces the existing ciphertext.
aiProviderGroup.MapPut("/{providerName}", async (
    string providerName,
    UpdateAiProviderConfigRequest request,
    ArcDropDbContext dbContext,
    IAiProviderSecretProtector secretProtector,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.ApiEndpoint) || string.IsNullOrWhiteSpace(request.Model))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.ApiEndpoint)] = ["API endpoint is required."],
            [nameof(request.Model)] = ["Model is required."]
        });
    }

    if (!Uri.TryCreate(request.ApiEndpoint, UriKind.Absolute, out _))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.ApiEndpoint)] = ["A valid absolute API endpoint is required."]
        });
    }

    var normalizedName = providerName.Trim();
    var config = await dbContext.AiProviderConfigs
        .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

    if (config is null)
    {
        return Results.NotFound();
    }

    config.ApiEndpoint = request.ApiEndpoint.Trim();
    config.Model = request.Model.Trim();

    var hasNewApiKey = !string.IsNullOrWhiteSpace(request.ApiKey);
    if (hasNewApiKey)
    {
        config.ApiKeyCipherText = secretProtector.Protect(request.ApiKey!.Trim());
    }

    config.UpdatedAtUtc = DateTimeOffset.UtcNow;
    await dbContext.SaveChangesAsync(cancellationToken);

    var apiKeyPreview = hasNewApiKey
        ? secretProtector.CreateMaskedPreview(request.ApiKey!.Trim())
        : "****";

    return Results.Ok(new AiProviderConfigResponse(
        config.Id,
        config.ProviderName,
        config.ApiEndpoint,
        config.Model,
        HasApiKey: !string.IsNullOrWhiteSpace(config.ApiKeyCipherText),
        ApiKeyPreview: apiKeyPreview,
        config.CreatedAtUtc,
        config.UpdatedAtUtc));
});

// Delete endpoint supports explicit provider profile cleanup during key rotations or provider offboarding.
aiProviderGroup.MapDelete("/{providerName}", async (
    string providerName,
    ArcDropDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var normalizedName = providerName.Trim();
    var config = await dbContext.AiProviderConfigs
        .SingleOrDefaultAsync(x => x.ProviderName == normalizedName, cancellationToken);

    if (config is null)
    {
        return Results.NotFound();
    }

    dbContext.AiProviderConfigs.Remove(config);
    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.NoContent();
});

// Organization command endpoint applies ArcDrop prompt policy and records auditable operation logs.
// This initial implementation uses deterministic local suggestion generation as a safe baseline until
// provider-specific adapters are introduced in the application layer.
aiGroup.MapPost("/organize", async (
    OrganizeBookmarkRequest request,
    ArcDropDbContext dbContext,
    ILogger<Program> logger,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.ProviderName) ||
        string.IsNullOrWhiteSpace(request.OperationType) ||
        string.IsNullOrWhiteSpace(request.BookmarkUrl) ||
        string.IsNullOrWhiteSpace(request.BookmarkTitle))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.ProviderName)] = ["Provider name is required."],
            [nameof(request.OperationType)] = ["Operation type is required."],
            [nameof(request.BookmarkUrl)] = ["Bookmark URL is required."],
            [nameof(request.BookmarkTitle)] = ["Bookmark title is required."]
        });
    }

    if (!Uri.TryCreate(request.BookmarkUrl, UriKind.Absolute, out _))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.BookmarkUrl)] = ["A valid absolute bookmark URL is required."]
        });
    }

    var normalizedOperationType = NormalizeOperationType(request.OperationType);
    if (normalizedOperationType is null)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.OperationType)] =
            ["Operation type must be one of: tag-suggestions, collection-suggestions, title-cleanup, summary-cleanup."]
        });
    }

    var providerName = request.ProviderName.Trim();
    var providerExists = await dbContext.AiProviderConfigs
        .AsNoTracking()
        .AnyAsync(x => x.ProviderName == providerName, cancellationToken);

    if (!providerExists)
    {
        return Results.NotFound();
    }

    var startedAtUtc = DateTimeOffset.UtcNow;
    var operationLog = new AiOperationLog
    {
        Id = Guid.NewGuid(),
        ProviderName = providerName,
        OperationType = normalizedOperationType,
        BookmarkUrl = request.BookmarkUrl.Trim(),
        BookmarkTitle = request.BookmarkTitle.Trim(),
        BookmarkSummary = string.IsNullOrWhiteSpace(request.BookmarkSummary) ? null : request.BookmarkSummary.Trim(),
        OutcomeStatus = "failure",
        StartedAtUtc = startedAtUtc,
        CompletedAtUtc = startedAtUtc
    };

    dbContext.AiOperationLogs.Add(operationLog);

    try
    {
        logger.LogInformation(
            "Applying ArcDrop system prompt template for operation '{OperationType}' using provider '{ProviderName}'. Template: {Template}",
            normalizedOperationType,
            providerName,
            ArcDropSystemPromptTemplate);

        var generatedResults = GenerateOrganizationResults(
            normalizedOperationType,
            request.BookmarkTitle,
            request.BookmarkSummary,
            request.BookmarkUrl);

        var completedAtUtc = DateTimeOffset.UtcNow;
        var resultEntities = generatedResults
            .Select(x => new AiOperationResult
            {
                Id = Guid.NewGuid(),
                OperationId = operationLog.Id,
                ResultType = x.ResultType,
                Value = x.Value,
                Confidence = x.Confidence,
                CreatedAtUtc = completedAtUtc
            })
            .ToList();

        dbContext.AiOperationResults.AddRange(resultEntities);

        operationLog.OutcomeStatus = "success";
        operationLog.FailureReason = null;
        operationLog.CompletedAtUtc = completedAtUtc;

        await dbContext.SaveChangesAsync(cancellationToken);

        var response = new OrganizeBookmarkResponse(
            operationLog.Id,
            providerName,
            normalizedOperationType,
            operationLog.OutcomeStatus,
            operationLog.StartedAtUtc,
            operationLog.CompletedAtUtc,
            resultEntities
                .Select(x => new AiOperationResultResponse(x.ResultType, x.Value, x.Confidence))
                .ToList());

        return Results.Ok(response);
    }
    catch (Exception exception)
    {
        operationLog.OutcomeStatus = "failure";
        operationLog.FailureReason = "Organization command failed before output could be persisted.";
        operationLog.CompletedAtUtc = DateTimeOffset.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogError(
            exception,
            "AI organization command failed for provider '{ProviderName}' and operation '{OperationType}'.",
            providerName,
            normalizedOperationType);

        return Results.Problem(
            title: "AI organization command failed.",
            detail: "See operation logs for failure metadata.",
            statusCode: StatusCodes.Status500InternalServerError);
    }
});

// Operation lookup endpoint allows clients and operators to inspect execution outcomes and generated outputs.
aiGroup.MapGet("/operations/{operationId:guid}", async (
    Guid operationId,
    ArcDropDbContext dbContext,
    CancellationToken cancellationToken) =>
{
    var operation = await dbContext.AiOperationLogs
        .AsNoTracking()
        .Include(x => x.Results)
        .SingleOrDefaultAsync(x => x.Id == operationId, cancellationToken);

    if (operation is null)
    {
        return Results.NotFound();
    }

    var response = new OrganizeBookmarkResponse(
        operation.Id,
        operation.ProviderName,
        operation.OperationType,
        operation.OutcomeStatus,
        operation.StartedAtUtc,
        operation.CompletedAtUtc,
        operation.Results
            .OrderBy(x => x.CreatedAtUtc)
            .Select(x => new AiOperationResultResponse(x.ResultType, x.Value, x.Confidence))
            .ToList());

    return Results.Ok(response);
});

// Bookmark endpoints provide the first persistence-backed API surface for TASK-003.
// These handlers intentionally implement explicit validation and timestamp control,
// making behavior deterministic for integration testing and future client workflows.
var bookmarksGroup = app.MapGroup("/api/bookmarks");

bookmarksGroup.MapGet("/", async (ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
{
    var bookmarks = await dbContext.Bookmarks
        .AsNoTracking()
        .OrderByDescending(x => x.UpdatedAtUtc)
        .Take(200)
        .Select(x => new BookmarkResponse(
            x.Id,
            x.Url,
            x.Title,
            x.Summary,
            x.CreatedAtUtc,
            x.UpdatedAtUtc))
        .ToListAsync(cancellationToken);

    return Results.Ok(bookmarks);
});

bookmarksGroup.MapGet("/{id:guid}", async (Guid id, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
{
    var bookmark = await dbContext.Bookmarks
        .AsNoTracking()
        .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

    if (bookmark is null)
    {
        return Results.NotFound();
    }

    return Results.Ok(new BookmarkResponse(
        bookmark.Id,
        bookmark.Url,
        bookmark.Title,
        bookmark.Summary,
        bookmark.CreatedAtUtc,
        bookmark.UpdatedAtUtc));
});

bookmarksGroup.MapPost("/", async (CreateBookmarkRequest request, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
{
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.Url)] = ["A valid absolute URL is required."]
        });
    }

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.Title)] = ["Title is required."]
        });
    }

    var utcNow = DateTimeOffset.UtcNow;
    var bookmark = new Bookmark
    {
        Id = Guid.NewGuid(),
        Url = request.Url.Trim(),
        Title = request.Title.Trim(),
        Summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary.Trim(),
        CreatedAtUtc = utcNow,
        UpdatedAtUtc = utcNow
    };

    dbContext.Bookmarks.Add(bookmark);
    await dbContext.SaveChangesAsync(cancellationToken);

    var response = new BookmarkResponse(
        bookmark.Id,
        bookmark.Url,
        bookmark.Title,
        bookmark.Summary,
        bookmark.CreatedAtUtc,
        bookmark.UpdatedAtUtc);

    return Results.Created($"/api/bookmarks/{bookmark.Id}", response);
});

bookmarksGroup.MapPut("/{id:guid}", async (Guid id, UpdateBookmarkRequest request, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
{
    if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.Url)] = ["A valid absolute URL is required."]
        });
    }

    if (string.IsNullOrWhiteSpace(request.Title))
    {
        return Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [nameof(request.Title)] = ["Title is required."]
        });
    }

    var bookmark = await dbContext.Bookmarks.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
    if (bookmark is null)
    {
        return Results.NotFound();
    }

    bookmark.Url = request.Url.Trim();
    bookmark.Title = request.Title.Trim();
    bookmark.Summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary.Trim();
    bookmark.UpdatedAtUtc = DateTimeOffset.UtcNow;

    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.Ok(new BookmarkResponse(
        bookmark.Id,
        bookmark.Url,
        bookmark.Title,
        bookmark.Summary,
        bookmark.CreatedAtUtc,
        bookmark.UpdatedAtUtc));
});

bookmarksGroup.MapDelete("/{id:guid}", async (Guid id, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
{
    var bookmark = await dbContext.Bookmarks.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
    if (bookmark is null)
    {
        return Results.NotFound();
    }

    dbContext.Bookmarks.Remove(bookmark);
    await dbContext.SaveChangesAsync(cancellationToken);

    return Results.NoContent();
});

app.Run();

static string? NormalizeOperationType(string rawOperationType)
{
    var normalized = rawOperationType.Trim().ToLowerInvariant();

    return normalized switch
    {
        "tag-suggestions" => normalized,
        "collection-suggestions" => normalized,
        "title-cleanup" => normalized,
        "summary-cleanup" => normalized,
        _ => null
    };
}

static bool ShouldUsePostgresEnvironmentFallback(string? configuredConnectionString)
{
    if (string.IsNullOrWhiteSpace(configuredConnectionString))
    {
        return true;
    }

    // Placeholder values are intentionally treated as unresolved credentials.
    return configuredConnectionString.Contains("ChangeThis", StringComparison.OrdinalIgnoreCase);
}

static IReadOnlyList<AiOperationResultResponse> GenerateOrganizationResults(
    string normalizedOperationType,
    string title,
    string? summary,
    string url)
{
    return normalizedOperationType switch
    {
        "tag-suggestions" => GenerateTagSuggestions(title, summary, url),
        "collection-suggestions" => GenerateCollectionSuggestions(title, summary, url),
        "title-cleanup" => GenerateTitleCleanup(title),
        "summary-cleanup" => GenerateSummaryCleanup(title, summary),
        _ => []
    };
}

static IReadOnlyList<AiOperationResultResponse> GenerateTagSuggestions(string title, string? summary, string url)
{
    var textSeed = $"{title} {summary} {url}";
    var tokens = Regex.Split(textSeed.ToLowerInvariant(), "[^a-z0-9]+")
        .Where(x => x.Length >= 4)
        .Where(x => !IsTagStopWord(x))
        .Distinct()
        .Take(5)
        .ToList();

    if (tokens.Count == 0)
    {
        tokens.Add("reference");
    }

    return tokens
        .Select((x, index) => new AiOperationResultResponse("tag", x, 0.95m - (index * 0.1m)))
        .ToList();
}

static IReadOnlyList<AiOperationResultResponse> GenerateCollectionSuggestions(string title, string? summary, string url)
{
    var source = $"{title} {summary} {url}".ToLowerInvariant();
    var collections = new List<AiOperationResultResponse>();

    if (source.Contains("dotnet") || source.Contains("csharp") || source.Contains("api") || source.Contains("dev"))
    {
        collections.Add(new AiOperationResultResponse("collection", "Engineering", 0.92m));
    }

    if (source.Contains("design") || source.Contains("ux") || source.Contains("ui"))
    {
        collections.Add(new AiOperationResultResponse("collection", "Design", 0.88m));
    }

    if (source.Contains("ai") || source.Contains("ml") || source.Contains("model"))
    {
        collections.Add(new AiOperationResultResponse("collection", "AI Research", 0.9m));
    }

    if (collections.Count == 0)
    {
        collections.Add(new AiOperationResultResponse("collection", "General", 0.7m));
    }

    return collections;
}

static IReadOnlyList<AiOperationResultResponse> GenerateTitleCleanup(string title)
{
    var collapsed = Regex.Replace(title.Trim(), "\\s+", " ");
    var textInfo = CultureInfo.InvariantCulture.TextInfo;
    var cleaned = textInfo.ToTitleCase(collapsed.ToLowerInvariant());

    return [new AiOperationResultResponse("title", cleaned, 0.9m)];
}

static IReadOnlyList<AiOperationResultResponse> GenerateSummaryCleanup(string title, string? summary)
{
    var normalizedTitle = Regex.Replace(title.Trim(), "\\s+", " ");
    var normalizedSummary = string.IsNullOrWhiteSpace(summary)
        ? $"Reference material about {normalizedTitle}."
        : Regex.Replace(summary.Trim(), "\\s+", " ");

    if (!normalizedSummary.EndsWith(".", StringComparison.Ordinal))
    {
        normalizedSummary += ".";
    }

    return [new AiOperationResultResponse("summary", normalizedSummary, 0.85m)];
}

static bool IsTagStopWord(string token)
{
    return token is
        "https" or
        "http" or
        "www" or
        "with" or
        "from" or
        "this" or
        "that" or
        "have" or
        "your" or
        "into" or
        "about" or
        "bookmark" or
        "title" or
        "summary";
}

static void ApplyEnvBackedConfiguration(ConfigurationManager configuration)
{
    SetConfigIfPresent(configuration, "Admin:Username", "ARCDROP_ADMIN_USERNAME");
    SetConfigIfPresent(configuration, "Admin:Password", "ARCDROP_ADMIN_PASSWORD");

    SetConfigIfPresent(configuration, "Jwt:Issuer", "ARCDROP_JWT_ISSUER");
    SetConfigIfPresent(configuration, "Jwt:Audience", "ARCDROP_JWT_AUDIENCE");
    SetConfigIfPresent(configuration, "Jwt:SigningKey", "ARCDROP_JWT_SIGNING_KEY");
    SetConfigIfPresent(configuration, "Jwt:AccessTokenLifetimeMinutes", "ARCDROP_JWT_ACCESS_TOKEN_LIFETIME_MINUTES");

    SetConfigIfPresent(configuration, "AdminCredentialPolicy:MinimumPasswordLength", "ARCDROP_ADMIN_CREDENTIAL_POLICY_MINIMUM_PASSWORD_LENGTH");
    SetConfigIfPresent(configuration, "AdminCredentialPolicy:RequireUppercase", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_UPPERCASE");
    SetConfigIfPresent(configuration, "AdminCredentialPolicy:RequireLowercase", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_LOWERCASE");
    SetConfigIfPresent(configuration, "AdminCredentialPolicy:RequireDigit", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_DIGIT");
    SetConfigIfPresent(configuration, "AdminCredentialPolicy:RequireSpecialCharacter", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_SPECIAL_CHARACTER");
    SetConfigIfPresent(configuration, "AdminCredentialPolicy:DisallowPasswordReuse", "ARCDROP_ADMIN_CREDENTIAL_POLICY_DISALLOW_PASSWORD_REUSE");
}

static void SetConfigIfPresent(ConfigurationManager configuration, string key, string envName)
{
    var value = Environment.GetEnvironmentVariable(envName);
    if (!string.IsNullOrWhiteSpace(value))
    {
        configuration[key] = value;
    }
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

            // Keep existing process-level values authoritative and avoid logging secret material.
            if (!string.IsNullOrWhiteSpace(key) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        // First discovered .env source wins to keep resolution deterministic.
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

// Expose the implicit Program type for WebApplicationFactory integration tests.
public partial class Program;
