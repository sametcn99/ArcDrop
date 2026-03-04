namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents one AI organization execution attempt for audit and troubleshooting.
/// This record captures normalized metadata and outcome status without storing any secret material.
/// </summary>
public sealed class AiOperationLog
{
    /// <summary>
    /// Stable operation identifier used to correlate output rows and API responses.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Provider profile name used to execute the operation.
    /// </summary>
    public string ProviderName { get; set; } = string.Empty;

    /// <summary>
    /// Operation type key (for example: tag-suggestions, title-cleanup).
    /// </summary>
    public string OperationType { get; set; } = string.Empty;

    /// <summary>
    /// Bookmark URL payload used for this operation.
    /// </summary>
    public string BookmarkUrl { get; set; } = string.Empty;

    /// <summary>
    /// Bookmark title payload used for this operation.
    /// </summary>
    public string BookmarkTitle { get; set; } = string.Empty;

    /// <summary>
    /// Optional bookmark summary payload used for this operation.
    /// </summary>
    public string? BookmarkSummary { get; set; }

    /// <summary>
    /// Normalized operation outcome (success or failure).
    /// </summary>
    public string OutcomeStatus { get; set; } = string.Empty;

    /// <summary>
    /// Failure detail used for operator troubleshooting when outcome is failure.
    /// </summary>
    public string? FailureReason { get; set; }

    /// <summary>
    /// UTC timestamp when execution started.
    /// </summary>
    public DateTimeOffset StartedAtUtc { get; set; }

    /// <summary>
    /// UTC timestamp when execution completed.
    /// </summary>
    public DateTimeOffset CompletedAtUtc { get; set; }

    /// <summary>
    /// Result records produced by this operation.
    /// </summary>
    public ICollection<AiOperationResult> Results { get; set; } = new List<AiOperationResult>();
}
