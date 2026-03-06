using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi;
using Scalar.AspNetCore;

namespace ArcDrop.Api.OpenApi;

/// <summary>
/// Registers ArcDrop-specific OpenAPI document metadata and Scalar UI endpoints.
/// The configuration keeps documentation behavior centralized so Program stays focused on composition.
/// </summary>
internal static class ArcDropOpenApiExtensions
{
    private const string DocumentName = "v1";
    private const string OpenApiRoutePattern = "/openapi/{documentName}.json";
    private const string BearerSchemeName = "Bearer";

    /// <summary>
    /// Adds the ArcDrop API document with consistent metadata, JWT security definitions, and transport-level descriptions.
    /// </summary>
    public static IServiceCollection AddArcDropApiDocumentation(this IServiceCollection services)
    {
        services.AddOpenApi(DocumentName, options =>
        {
            options.AddDocumentTransformer((document, _, _) =>
            {
                var bearerScheme = CreateBearerSecurityScheme();

                document.Info = new OpenApiInfo
                {
                    Title = "ArcDrop API",
                    Version = DocumentName,
                    Description = "Self-host ArcDrop backend API for authentication, bookmarks, collections, AI workflows, and portability operations."
                };

                var components = document.Components ?? new OpenApiComponents();
                components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>(StringComparer.Ordinal);
                components.SecuritySchemes[BearerSchemeName] = bearerScheme;
                document.Components = components;

                return Task.CompletedTask;
            });

            options.AddOperationTransformer((operation, context, _) =>
            {
                var endpointMetadata = context.Description.ActionDescriptor.EndpointMetadata;
                var allowsAnonymous = endpointMetadata.OfType<IAllowAnonymous>().Any();
                var requiresAuthorization = endpointMetadata.OfType<IAuthorizeData>().Any();

                if (requiresAuthorization && !allowsAnonymous)
                {
                    operation.Responses ??= [];
                    operation.Responses.TryAdd("401", new OpenApiResponse
                    {
                        Description = "Authentication is required or the bearer token is invalid."
                    });

                    operation.Responses.TryAdd("403", new OpenApiResponse
                    {
                        Description = "The authenticated caller is not authorized for this operation."
                    });
                }

                return Task.CompletedTask;
            });
        });

        return services;
    }

    /// <summary>
    /// Maps the runtime OpenAPI JSON and Scalar reference UI routes.
    /// </summary>
    public static WebApplication MapArcDropApiDocumentation(this WebApplication app)
    {
        app.MapOpenApi(OpenApiRoutePattern);

        app.MapScalarApiReference("/docs", (options, httpContext) =>
        {
            var baseServerUrl = $"{httpContext.Request.Scheme}://{httpContext.Request.Host}";

            options.WithTitle("ArcDrop API Console");
            options.WithOpenApiRoutePattern(OpenApiRoutePattern);
            options.WithOperationTitleSource(OperationTitleSource.Summary);
            options.WithTheme(ScalarTheme.BluePlanet);
            options.WithSearchHotKey("k");
            options.SortTagsAlphabetically();
            options.SortOperationsByMethod();
            options.WithDefaultHttpClient(ScalarTarget.CSharp, ScalarClient.HttpClient);
            options.WithBaseServerUrl(baseServerUrl);
        });

        return app;
    }

    private static OpenApiSecurityScheme CreateBearerSecurityScheme()
    {
        return new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Name = "Authorization",
            Description = "Provide the JWT access token returned by POST /api/auth/login using the format: Bearer {token}."
        };
    }
}

/// <summary>
/// Detects whether the application entry point is running under the build-time OpenAPI document generator.
/// This prevents startup-only operational work such as database migration from executing during contract generation.
/// </summary>
internal static class OpenApiBuildTimeExecutionDetector
{
    private const string BuildTimeHostName = "GetDocument.Insider";

    /// <summary>
    /// Returns true when the current process was launched by the ASP.NET Core build-time OpenAPI toolchain.
    /// </summary>
    public static bool IsActive()
    {
        return string.Equals(
            Assembly.GetEntryAssembly()?.GetName().Name,
            BuildTimeHostName,
            StringComparison.Ordinal);
    }
}