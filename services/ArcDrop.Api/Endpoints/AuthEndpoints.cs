using ArcDrop.Api.Contracts;
using ArcDrop.Application.Authentication;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers fixed-admin authentication endpoints used in self-host v1 deployments.
/// </summary>
internal static class AuthEndpoints
{
    public static void MapAuth(WebApplication app)
    {
        var authGroup = app.MapGroup("/api/auth").WithTags("Authentication");

        authGroup.MapPost("/login", async (
            LoginRequest request,
            IAdminAuthenticationService authenticationService,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Username)] = ["Username is required."],
                    [nameof(request.Password)] = ["Password is required."]
                });
            }

            var loginResult = await authenticationService.LoginAsync(request.Username, request.Password, cancellationToken);
            if (!loginResult.Success || string.IsNullOrWhiteSpace(loginResult.AccessToken) || !loginResult.ExpiresAtUtc.HasValue)
            {
                return Results.Unauthorized();
            }

            return Results.Ok(new LoginResponse(loginResult.AccessToken, loginResult.ExpiresAtUtc.Value));
        })
        .WithName("LoginAdmin")
        .WithSummary("Authenticates the fixed admin account.")
        .WithDescription("Validates fixed-admin credentials and returns a signed JWT access token for protected ArcDrop API operations. Implements FR-002 authentication bootstrap behavior.")
        .Accepts<LoginRequest>("application/json")
        .Produces<LoginResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .AllowAnonymous();

        authGroup.MapGet("/me", [Authorize] (ClaimsPrincipal user) =>
        {
            var username = user.Identity?.Name
                ?? user.FindFirstValue(ClaimTypes.Name)
                ?? user.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? user.FindFirstValue("unique_name")
                ?? "unknown";

            return Results.Ok(new CurrentAdminResponse(username, Authenticated: true));
        })
        .WithName("GetCurrentAdminProfile")
        .WithSummary("Returns the authenticated admin profile.")
        .WithDescription("Reads the current JWT identity and returns a compact authenticated profile for session validation flows.")
        .Produces<CurrentAdminResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden);

        authGroup.MapPost("/rotate-password", [Authorize(Roles = "Admin")] async (
            RotateAdminPasswordRequest request,
            ClaimsPrincipal user,
            IAdminCredentialService credentialService,
            IAdminAuthenticationService authenticationService,
            CancellationToken cancellationToken) =>
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

            var rotationResult = await authenticationService.RotatePasswordAsync(
                username,
                request.CurrentPassword,
                request.NewPassword,
                cancellationToken);
            if (!rotationResult.Success)
            {
                var validationErrors = new Dictionary<string, string[]>
                {
                    [nameof(request.NewPassword)] = [rotationResult.ValidationError ?? "Password rotation failed."]
                };

                if (rotationResult.CurrentCredentialsInvalid)
                {
                    return Results.Unauthorized();
                }

                return Results.ValidationProblem(validationErrors);
            }

            return Results.NoContent();
        })
        .WithName("RotateAdminPassword")
        .WithSummary("Rotates the fixed admin password.")
        .WithDescription("Uses the current password as proof of possession, enforces configured password policy rules, and updates the fixed-admin credential used by self-host deployments.")
        .Accepts<RotateAdminPasswordRequest>("application/json")
        .Produces(StatusCodes.Status204NoContent)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden);
    }
}
