namespace ArcDrop.Application.Ai;

/// <summary>
/// Provides deterministic bookmark organization suggestions for the currently supported operation types.
/// This contract keeps prompt-independent suggestion logic inside the application layer.
/// </summary>
public interface IOrganizationSuggestionService
{
    /// <summary>
    /// Normalizes and validates the requested operation type.
    /// Returns null when the operation type is unsupported.
    /// </summary>
    string? NormalizeOperationType(string rawOperationType);

    /// <summary>
    /// Generates deterministic suggestion results for a normalized operation type.
    /// </summary>
    IReadOnlyList<OrganizationSuggestionItem> GenerateResults(
        string normalizedOperationType,
        string title,
        string? summary,
        string url);
}
