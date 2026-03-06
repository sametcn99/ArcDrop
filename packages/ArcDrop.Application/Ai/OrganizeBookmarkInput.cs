namespace ArcDrop.Application.Ai;

/// <summary>
/// Represents one bookmark organization request executed against a configured AI provider profile.
/// </summary>
public sealed record OrganizeBookmarkInput(
    string ProviderName,
    string OperationType,
    string BookmarkUrl,
    string BookmarkTitle,
    string? BookmarkSummary);