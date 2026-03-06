namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents one normalized suggestion produced by an organization action.
/// </summary>
public sealed record AiOrganizationResultItem(
    string ResultType,
    string Value,
    decimal? Confidence);