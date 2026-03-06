namespace ArcDrop.Application.Portability;

/// <summary>
/// Summarizes the outcome of a bookmark import workflow for operator confirmation.
/// Counts are explicit so callers can verify whether data was created, updated, or skipped.
/// </summary>
/// <param name="CollectionsCreated">Number of collections created during import.</param>
/// <param name="BookmarksCreated">Number of new bookmarks created during import.</param>
/// <param name="BookmarksUpdated">Number of existing bookmarks updated during import.</param>
/// <param name="BookmarksSkipped">Number of bookmarks skipped because they were invalid or unchanged.</param>
/// <param name="Warnings">Operator-visible warnings explaining lossy or partial import outcomes.</param>
public sealed record ImportBookmarksResult(
    int CollectionsCreated,
    int BookmarksCreated,
    int BookmarksUpdated,
    int BookmarksSkipped,
    IReadOnlyList<string> Warnings);