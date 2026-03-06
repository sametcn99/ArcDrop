namespace ArcDrop.Application.Ai;

/// <summary>
/// Persists and retrieves auditable AI organization operation records.
/// Implementations own provider existence checks and operation result storage details.
/// </summary>
public interface IAiOrganizationOperationStore
{
    /// <summary>
    /// Returns whether a provider profile exists for the supplied provider name.
    /// </summary>
    Task<bool> ProviderExistsAsync(string providerName, CancellationToken cancellationToken);

    /// <summary>
    /// Creates a pending operation log before suggestion generation begins.
    /// </summary>
    Task<Guid> CreatePendingOperationAsync(
        string providerName,
        string operationType,
        string bookmarkUrl,
        string bookmarkTitle,
        string? bookmarkSummary,
        DateTimeOffset startedAtUtc,
        CancellationToken cancellationToken);

    /// <summary>
    /// Persists successful result items and finalizes the operation status.
    /// </summary>
    Task<AiOrganizationOperationItem> CompleteSuccessfulOperationAsync(
        Guid operationId,
        IReadOnlyList<AiOrganizationResultItem> results,
        DateTimeOffset completedAtUtc,
        CancellationToken cancellationToken);

    /// <summary>
    /// Marks an operation as failed and returns the updated operation record when available.
    /// </summary>
    Task<AiOrganizationOperationItem?> CompleteFailedOperationAsync(
        Guid operationId,
        string failureReason,
        DateTimeOffset completedAtUtc,
        CancellationToken cancellationToken);

    /// <summary>
    /// Returns one persisted operation by identifier, or null when it does not exist.
    /// </summary>
    Task<AiOrganizationOperationItem?> GetOperationAsync(Guid operationId, CancellationToken cancellationToken);
}