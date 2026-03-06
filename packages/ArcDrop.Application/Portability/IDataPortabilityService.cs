namespace ArcDrop.Application.Portability;

/// <summary>
/// Coordinates bookmark import and export workflows behind a transport-agnostic contract.
/// Implements FR-004 and AC-004 portability behavior while keeping endpoint modules thin.
/// </summary>
public interface IDataPortabilityService
{
    /// <summary>
    /// Exports bookmarks in the requested format and scope.
    /// </summary>
    Task<ExportedBookmarksFile> ExportAsync(ExportBookmarksInput input, CancellationToken cancellationToken);

    /// <summary>
    /// Imports bookmarks from a portable payload and persists the resulting changes.
    /// </summary>
    Task<ImportBookmarksResult> ImportAsync(ImportBookmarksInput input, CancellationToken cancellationToken);
}