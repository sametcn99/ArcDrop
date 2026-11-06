namespace ArcDrop.Application.Ai;

/// <summary>
/// Coordinates AI organization workflows so API endpoints remain focused on transport concerns.
/// </summary>
public interface IAiOrganizationService
{
    /// <summary>
    /// Executes one organization operation and returns validation, not-found, or persisted result data.
    /// </summary>
    Task<AiOrganizationCommandResult> OrganizeAsync(OrganizeBookmarkInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Returns one previously executed organization operation by identifier.
    /// </summary>
    Task<AiOrganizationOperationItem?> GetOperationAsync(Guid operationId, CancellationToken cancellationToken);

    /// <summary>
    /// Returns one page of persisted operation audit records ordered newest first.
    /// </summary>
    Task<AiOperationListResult> ListOperationsAsync(AiOperationListQuery query, CancellationToken cancellationToken);
}