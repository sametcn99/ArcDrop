using ArcDrop.Api.Contracts;
using ArcDrop.Application.Authentication;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers lightweight readiness and health endpoints.
/// </summary>
internal static class SystemEndpoints
{
    public static void MapSystem(WebApplication app)
    {
        // The root endpoint provides a lightweight readiness message for operators and CI smoke checks.
        app.MapGet("/", () => Results.Ok(new ApiReadinessResponse(
            "ArcDrop API",
            "ArcDrop API started successfully.",
            DateTimeOffset.UtcNow)))
            .WithName("GetApiReadiness")
            .WithTags("System")
            .WithSummary("Returns a lightweight readiness payload.")
            .WithDescription("Supports operator smoke checks and self-host bootstrap verification without exposing internal state. Implements FR-002 readiness checks for self-host deployments.")
            .Produces<ApiReadinessResponse>(StatusCodes.Status200OK);

        // Health endpoint returns compact deployment diagnostics without exposing sensitive values.
        app.MapGet("/health", (IAdminCredentialService credentialService) =>
        {
            var adminConfigurationDetected = credentialService.IsConfigured;

            return Results.Ok(new ApiHealthResponse(
                "Healthy",
                "ArcDrop API",
                app.Environment.EnvironmentName,
                adminConfigurationDetected,
                DateTimeOffset.UtcNow));
        })
            .WithName("GetApiHealth")
            .WithTags("System")
            .WithSummary("Returns a compact health payload.")
            .WithDescription("Reports deployment environment and whether fixed-admin credentials are configured without returning secret values. Supports FR-002 operational health checks.")
            .Produces<ApiHealthResponse>(StatusCodes.Status200OK);
    }
}
