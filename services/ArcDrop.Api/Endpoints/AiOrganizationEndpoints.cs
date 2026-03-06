using ArcDrop.Api.Contracts;
using ArcDrop.Application.Ai;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers AI organization endpoints and records auditable operation logs.
/// </summary>
internal static class AiOrganizationEndpoints
{
    private const string ArcDropSystemPromptTemplate =
        "You are ArcDrop Organizer. Return deterministic, concise suggestions for bookmark organization. " +
        "Never include secrets. Use English-only outputs and keep results structured by operation type.";

    public static void MapAiOrganization(WebApplication app)
    {
        var aiGroup = app.MapGroup("/api/ai").RequireAuthorization();

        aiGroup.MapPost("/organize", async (
            OrganizeBookmarkRequest request,
            ArcDropDbContext dbContext,
            IOrganizationSuggestionService suggestionService,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            var logger = loggerFactory.CreateLogger("ArcDrop.Api.AiOrganization");

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

            var normalizedOperationType = suggestionService.NormalizeOperationType(request.OperationType);
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
                // Log prompt policy template usage for auditable operation traces without logging secrets.
                logger.LogInformation(
                    "Applying ArcDrop system prompt template for operation '{OperationType}' using provider '{ProviderName}'. Template: {Template}",
                    normalizedOperationType,
                    providerName,
                    ArcDropSystemPromptTemplate);

                var generatedResults = suggestionService.GenerateResults(
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
    }
}
