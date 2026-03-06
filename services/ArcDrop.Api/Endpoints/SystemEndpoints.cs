using ArcDrop.Api.Security;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers lightweight readiness and health endpoints.
/// </summary>
internal static class SystemEndpoints
{
    public static void MapSystem(WebApplication app)
    {
        // The root endpoint provides a lightweight readiness message for operators and CI smoke checks.
        app.MapGet("/", () => Results.Ok(new
        {
            Service = "ArcDrop API",
            Message = "ArcDrop API started successfully.",
            UtcTimestamp = DateTimeOffset.UtcNow
        }));

        // Health endpoint returns compact deployment diagnostics without exposing sensitive values.
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
    }
}
