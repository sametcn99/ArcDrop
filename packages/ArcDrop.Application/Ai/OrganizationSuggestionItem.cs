namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents one deterministic organization suggestion output item.
/// </summary>
public sealed record OrganizationSuggestionItem(string ResultType, string Value, decimal Confidence);
