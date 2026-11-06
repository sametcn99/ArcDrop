namespace ArcDrop.Application.Bookmarks;

/// <summary>
/// Represents lightweight bookmark counters used by navigation and dashboard surfaces.
/// </summary>
public sealed record BookmarkStats(int TotalCount, int UnassignedCount);
