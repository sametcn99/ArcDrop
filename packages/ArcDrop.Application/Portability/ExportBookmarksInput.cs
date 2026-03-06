namespace ArcDrop.Application.Portability;

/// <summary>
/// Describes which bookmarks should be exported and in which portable format.
/// Null collection scope exports everything, an empty scope exports only unassigned bookmarks.
/// </summary>
/// <param name="Format">Target format for the exported file payload.</param>
/// <param name="CollectionIds">Optional collection filter to narrow the export scope.</param>
public sealed record ExportBookmarksInput(DataPortabilityFormat Format, IReadOnlyList<Guid>? CollectionIds);