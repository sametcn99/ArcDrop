using ArcDrop.Api.Contracts;
using ArcDrop.Api.Security;
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
        })
        .AllowAnonymous();

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
    }
}
