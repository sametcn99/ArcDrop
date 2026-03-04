namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents create input for bookmark add workflows.
/// </summary>
public sealed record CreateBookmarkInput(
    string Url,
    string Title,
    string? Summary);
