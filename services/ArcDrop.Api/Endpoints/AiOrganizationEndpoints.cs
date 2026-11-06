using ArcDrop.Api.Contracts;
using ArcDrop.Application.Ai;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers AI organization endpoints and records auditable operation logs.
/// </summary>
internal static class AiOrganizationEndpoints
{
    public static void MapAiOrganization(WebApplication app)
    {
        var aiGroup = app.MapGroup("/api/ai")
            .WithTags("AI Organization")
            .RequireAuthorization();

        aiGroup.MapPost("/organize", async (
            OrganizeBookmarkRequest request,
            IAiOrganizationService organizationService,
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

            var result = await organizationService.OrganizeAsync(
                new OrganizeBookmarkInput(
                    request.ProviderName,
                    request.OperationType,
                    request.BookmarkUrl,
                    request.BookmarkTitle,
                    request.BookmarkSummary),
                cancellationToken);

            if (!result.ProviderFound)
            {
                return Results.NotFound();
            }

            if (!string.IsNullOrWhiteSpace(result.ValidationError))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [result.ValidationTarget ?? nameof(request.OperationType)] = [result.ValidationError]
                });
            }

            if (result.ProcessingFailed)
            {
                return Results.Problem(
                    title: "AI organization command failed.",
                    detail: "See operation logs for failure metadata.",
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            return Results.Ok(MapResponse(result.Operation!));
        })
        .WithName("OrganizeBookmark")
        .WithSummary("Runs an AI organization operation.")
        .WithDescription("Executes a deterministic bookmark organization command using a configured AI provider profile and stores auditable operation results. Implements FR-008 and NFR-006 behavior.")
        .Accepts<OrganizeBookmarkRequest>("application/json")
        .Produces<OrganizeBookmarkResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status500InternalServerError);

        aiGroup.MapGet("/operations/{operationId:guid}", async (
            Guid operationId,
            IAiOrganizationService organizationService,
            CancellationToken cancellationToken) =>
        {
            var operation = await organizationService.GetOperationAsync(operationId, cancellationToken);

            if (operation is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(MapResponse(operation));
        })
        .WithName("GetAiOperation")
        .WithSummary("Returns one AI operation log.")
        .WithDescription("Loads the persisted AI organization operation record and normalized result payload for operator auditing.")
        .Produces<OrganizeBookmarkResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);

        aiGroup.MapGet("/operations", async (
            int? page,
            int? pageSize,
            string? providerName,
            string? operationType,
            IAiOrganizationService organizationService,
            CancellationToken cancellationToken) =>
        {
            var result = await organizationService.ListOperationsAsync(
                new AiOperationListQuery(page ?? 1, pageSize ?? 20, providerName, operationType),
                cancellationToken);

            return Results.Ok(new AiOperationListResponse(
                result.Items
                    .Select(operation => new AiOperationSummaryResponse(
                        operation.OperationId,
                        operation.ProviderName,
                        operation.OperationType,
                        operation.OutcomeStatus,
                        operation.BookmarkTitle,
                        operation.BookmarkUrl,
                        operation.StartedAtUtc,
                        operation.CompletedAtUtc))
                    .ToList(),
                result.TotalCount,
                result.Page,
                result.PageSize));
        })
        .WithName("ListAiOperations")
        .WithSummary("Lists AI operation audit history.")
        .WithDescription("Returns one page of persisted AI organization operations ordered newest first. Supports providerName and operationType filters with page and pageSize (max 100). Implements NFR-006 audit visibility.")
        .Produces<AiOperationListResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden);
    }

    private static OrganizeBookmarkResponse MapResponse(AiOrganizationOperationItem operation)
    {
        return new OrganizeBookmarkResponse(
            operation.OperationId,
            operation.ProviderName,
            operation.OperationType,
            operation.OutcomeStatus,
            operation.StartedAtUtc,
            operation.CompletedAtUtc,
            operation.Results
                .Select(result => new AiOperationResultResponse(result.ResultType, result.Value, result.Confidence))
                .ToList());
    }
}
