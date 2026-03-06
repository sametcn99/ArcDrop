using ArcDrop.Api.Contracts;
using ArcDrop.Application.Ai;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers AI provider configuration endpoints with encrypted API key persistence semantics.
/// </summary>
internal static class AiProviderEndpoints
{
    public static void MapAiProviders(WebApplication app)
    {
        var aiProviderGroup = app.MapGroup("/api/ai/providers")
            .WithTags("AI Providers")
            .RequireAuthorization();

        aiProviderGroup.MapGet("/", async (IAiProviderConfigService aiProviderService, CancellationToken cancellationToken) =>
        {
            var providers = await aiProviderService.GetProvidersAsync(cancellationToken);
            return Results.Ok(providers.Select(MapResponse).ToList());
        })
        .WithName("ListAiProviders")
        .WithSummary("Lists configured AI providers.")
        .WithDescription("Returns the stored AI provider configuration profiles with masked secret previews for FR-007 operator management flows.")
        .Produces<List<AiProviderConfigResponse>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden);

        aiProviderGroup.MapPost("/", async (
            UpsertAiProviderConfigRequest request,
            IAiProviderConfigService aiProviderService,
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

            var result = await aiProviderService.UpsertProviderAsync(
                new UpsertAiProviderConfigInput(request.ProviderName, request.ApiEndpoint, request.Model, request.ApiKey),
                cancellationToken);

            if (result.Config is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [result.ValidationTarget ?? nameof(request.ProviderName)] = [result.ValidationError ?? "Provider save failed."]
                });
            }

            if (result.Created)
            {
                return Results.Created($"/api/ai/providers/{Uri.EscapeDataString(result.Config.ProviderName)}", MapResponse(result.Config));
            }

            return Results.Ok(MapResponse(result.Config));
        })
        .WithName("UpsertAiProvider")
        .WithSummary("Creates or replaces an AI provider profile.")
        .WithDescription("Validates provider configuration, encrypts the supplied API key, and stores a provider profile used by AI organization workflows.")
        .Accepts<UpsertAiProviderConfigRequest>("application/json")
        .Produces<AiProviderConfigResponse>(StatusCodes.Status201Created)
        .Produces<AiProviderConfigResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden);

        aiProviderGroup.MapGet("/{providerName}", async (
            string providerName,
            IAiProviderConfigService aiProviderService,
            CancellationToken cancellationToken) =>
        {
            var config = await aiProviderService.GetProviderAsync(providerName, cancellationToken);
            return config is null ? Results.NotFound() : Results.Ok(MapResponse(config));
        })
        .WithName("GetAiProviderByName")
        .WithSummary("Returns one AI provider profile.")
        .WithDescription("Loads one provider configuration profile by its operator-facing provider name.")
        .Produces<AiProviderConfigResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);

        aiProviderGroup.MapPut("/{providerName}", async (
            string providerName,
            UpdateAiProviderConfigRequest request,
            IAiProviderConfigService aiProviderService,
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

            var result = await aiProviderService.UpdateProviderAsync(
                new UpdateAiProviderConfigInput(providerName, request.ApiEndpoint, request.Model, request.ApiKey),
                cancellationToken);

            if (result.NotFound)
            {
                return Results.NotFound();
            }

            if (result.Config is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [result.ValidationTarget ?? nameof(request.ApiEndpoint)] = [result.ValidationError ?? "Provider update failed."]
                });
            }

            return Results.Ok(MapResponse(result.Config));
        })
        .WithName("UpdateAiProvider")
        .WithSummary("Updates an AI provider profile.")
        .WithDescription("Updates endpoint and model settings and optionally rotates the encrypted provider API key for an existing profile.")
        .Accepts<UpdateAiProviderConfigRequest>("application/json")
        .Produces<AiProviderConfigResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);

        aiProviderGroup.MapDelete("/{providerName}", async (
            string providerName,
            IAiProviderConfigService aiProviderService,
            CancellationToken cancellationToken) =>
        {
            var deleted = await aiProviderService.DeleteProviderAsync(providerName, cancellationToken);
            return deleted ? Results.NoContent() : Results.NotFound();
        })
        .WithName("DeleteAiProvider")
        .WithSummary("Deletes an AI provider profile.")
        .WithDescription("Removes one stored AI provider configuration profile by name.")
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);
    }

    private static AiProviderConfigResponse MapResponse(AiProviderConfigItem config)
    {
        return new AiProviderConfigResponse(
            config.Id,
            config.ProviderName,
            config.ApiEndpoint,
            config.Model,
            config.HasApiKey,
            config.ApiKeyPreview,
            config.CreatedAtUtc,
            config.UpdatedAtUtc);
    }
}
