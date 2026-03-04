namespace ArcDrop.Domain.Entities;

/// <summary>
/// Represents one structured AI suggestion or cleanup result produced by an operation.
/// </summary>
public sealed class AiOperationResult
{
    /// <summary>
    /// Stable result identifier.
    /// </summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Parent operation identifier.
    /// </summary>
    public Guid OperationId { get; set; }

    /// <summary>
    /// Semantic result type (for example: tag, collection, title, summary).
    /// </summary>
    public string ResultType { get; set; } = string.Empty;

    /// <summary>
    /// Suggestion payload content.
    /// </summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Optional confidence score in [0, 1] range.
    /// </summary>
    public decimal? Confidence { get; set; }

    /// <summary>
    /// UTC creation timestamp.
    /// </summary>
    public DateTimeOffset CreatedAtUtc { get; set; }

    /// <summary>
    /// Parent operation navigation.
    /// </summary>
    public AiOperationLog Operation { get; set; } = null!;
}
