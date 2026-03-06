using ArcDrop.Application.Ai;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Infrastructure.Ai;

/// <summary>
/// Persists AI organization operation logs and results with EF Core.
/// </summary>
public sealed class EfCoreAiOrganizationOperationStore(ArcDropDbContext dbContext) : IAiOrganizationOperationStore
{
    /// <inheritdoc />
    public Task<bool> ProviderExistsAsync(string providerName, CancellationToken cancellationToken)
    {
        return dbContext.AiProviderConfigs
            .AsNoTracking()
            .AnyAsync(x => x.ProviderName == providerName, cancellationToken);
    }

    /// <inheritdoc />
    public async Task<Guid> CreatePendingOperationAsync(
        string providerName,
        string operationType,
        string bookmarkUrl,
        string bookmarkTitle,
        string? bookmarkSummary,
        DateTimeOffset startedAtUtc,
        CancellationToken cancellationToken)
    {
        var operationLog = new AiOperationLog
        {
            Id = Guid.NewGuid(),
            ProviderName = providerName,
            OperationType = operationType,
            BookmarkUrl = bookmarkUrl,
            BookmarkTitle = bookmarkTitle,
            BookmarkSummary = bookmarkSummary,
            OutcomeStatus = "failure",
            StartedAtUtc = startedAtUtc,
            CompletedAtUtc = startedAtUtc
        };

        dbContext.AiOperationLogs.Add(operationLog);
        await dbContext.SaveChangesAsync(cancellationToken);
        return operationLog.Id;
    }

    /// <inheritdoc />
    public async Task<AiOrganizationOperationItem> CompleteSuccessfulOperationAsync(
        Guid operationId,
        IReadOnlyList<AiOrganizationResultItem> results,
        DateTimeOffset completedAtUtc,
        CancellationToken cancellationToken)
    {
        var operationLog = await dbContext.AiOperationLogs
            .Include(x => x.Results)
            .SingleAsync(x => x.Id == operationId, cancellationToken);

        var resultEntities = results
            .Select(item => new AiOperationResult
            {
                Id = Guid.NewGuid(),
                OperationId = operationLog.Id,
                ResultType = item.ResultType,
                Value = item.Value,
                Confidence = item.Confidence,
                CreatedAtUtc = completedAtUtc
            })
            .ToList();

        dbContext.AiOperationResults.AddRange(resultEntities);

        operationLog.OutcomeStatus = "success";
        operationLog.FailureReason = null;
        operationLog.CompletedAtUtc = completedAtUtc;

        await dbContext.SaveChangesAsync(cancellationToken);

        return new AiOrganizationOperationItem(
            operationLog.Id,
            operationLog.ProviderName,
            operationLog.OperationType,
            operationLog.OutcomeStatus,
            operationLog.StartedAtUtc,
            operationLog.CompletedAtUtc,
            resultEntities
                .OrderBy(x => x.CreatedAtUtc)
                .Select(MapResult)
                .ToList());
    }

    /// <inheritdoc />
    public async Task<AiOrganizationOperationItem?> CompleteFailedOperationAsync(
        Guid operationId,
        string failureReason,
        DateTimeOffset completedAtUtc,
        CancellationToken cancellationToken)
    {
        var operationLog = await dbContext.AiOperationLogs
            .Include(x => x.Results)
            .SingleOrDefaultAsync(x => x.Id == operationId, cancellationToken);

        if (operationLog is null)
        {
            return null;
        }

        operationLog.OutcomeStatus = "failure";
        operationLog.FailureReason = failureReason;
        operationLog.CompletedAtUtc = completedAtUtc;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapOperation(operationLog);
    }

    /// <inheritdoc />
    public async Task<AiOrganizationOperationItem?> GetOperationAsync(Guid operationId, CancellationToken cancellationToken)
    {
        var operation = await dbContext.AiOperationLogs
            .AsNoTracking()
            .Include(x => x.Results)
            .SingleOrDefaultAsync(x => x.Id == operationId, cancellationToken);

        return operation is null ? null : MapOperation(operation);
    }

    private static AiOrganizationOperationItem MapOperation(AiOperationLog operation)
    {
        return new AiOrganizationOperationItem(
            operation.Id,
            operation.ProviderName,
            operation.OperationType,
            operation.OutcomeStatus,
            operation.StartedAtUtc,
            operation.CompletedAtUtc,
            operation.Results
                .OrderBy(x => x.CreatedAtUtc)
                .Select(MapResult)
                .ToList());
    }

    private static AiOrganizationResultItem MapResult(AiOperationResult result)
    {
        return new AiOrganizationResultItem(result.ResultType, result.Value, result.Confidence);
    }
}