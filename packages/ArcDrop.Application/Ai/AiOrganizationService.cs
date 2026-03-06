using Microsoft.Extensions.Logging;

namespace ArcDrop.Application.Ai;

/// <summary>
/// Executes ArcDrop AI organization workflows while keeping prompt policy, validation, and failure handling centralized.
/// </summary>
public sealed class AiOrganizationService(
    IOrganizationSuggestionService suggestionService,
    IAiOrganizationOperationStore operationStore,
    ILogger<AiOrganizationService> logger) : IAiOrganizationService
{
    private const string ArcDropSystemPromptTemplate =
        "You are ArcDrop Organizer. Return deterministic, concise suggestions for bookmark organization. " +
        "Never include secrets. Use English-only outputs and keep results structured by operation type.";

    /// <inheritdoc />
    public async Task<AiOrganizationCommandResult> OrganizeAsync(OrganizeBookmarkInput input, CancellationToken cancellationToken)
    {
        var normalizedOperationType = suggestionService.NormalizeOperationType(input.OperationType);
        if (normalizedOperationType is null)
        {
            return new AiOrganizationCommandResult(
                null,
                ProviderFound: true,
                ProcessingFailed: false,
                ValidationTarget: nameof(input.OperationType),
                ValidationError: "Operation type must be one of: tag-suggestions, collection-suggestions, title-cleanup, summary-cleanup.");
        }

        var providerName = input.ProviderName.Trim();
        var providerExists = await operationStore.ProviderExistsAsync(providerName, cancellationToken);
        if (!providerExists)
        {
            return new AiOrganizationCommandResult(null, ProviderFound: false, ProcessingFailed: false, null, null);
        }

        var startedAtUtc = DateTimeOffset.UtcNow;
        var operationId = await operationStore.CreatePendingOperationAsync(
            providerName,
            normalizedOperationType,
            input.BookmarkUrl.Trim(),
            input.BookmarkTitle.Trim(),
            string.IsNullOrWhiteSpace(input.BookmarkSummary) ? null : input.BookmarkSummary.Trim(),
            startedAtUtc,
            cancellationToken);

        try
        {
            // Record prompt policy application in structured logs without emitting bookmark secrets or provider credentials.
            logger.LogInformation(
                "Applying ArcDrop system prompt template for operation '{OperationType}' using provider '{ProviderName}'. Template: {Template}",
                normalizedOperationType,
                providerName,
                ArcDropSystemPromptTemplate);

            var generatedResults = suggestionService.GenerateResults(
                normalizedOperationType,
                input.BookmarkTitle,
                input.BookmarkSummary,
                input.BookmarkUrl)
                .Select(item => new AiOrganizationResultItem(item.ResultType, item.Value, item.Confidence))
                .ToList();

            var operation = await operationStore.CompleteSuccessfulOperationAsync(
                operationId,
                generatedResults,
                DateTimeOffset.UtcNow,
                cancellationToken);

            return new AiOrganizationCommandResult(operation, ProviderFound: true, ProcessingFailed: false, null, null);
        }
        catch (Exception exception)
        {
            await operationStore.CompleteFailedOperationAsync(
                operationId,
                "Organization command failed before output could be persisted.",
                DateTimeOffset.UtcNow,
                cancellationToken);

            logger.LogError(
                exception,
                "AI organization command failed for provider '{ProviderName}' and operation '{OperationType}'.",
                providerName,
                normalizedOperationType);

            return new AiOrganizationCommandResult(null, ProviderFound: true, ProcessingFailed: true, null, null);
        }
    }

    /// <inheritdoc />
    public Task<AiOrganizationOperationItem?> GetOperationAsync(Guid operationId, CancellationToken cancellationToken)
    {
        return operationStore.GetOperationAsync(operationId, cancellationToken);
    }
}