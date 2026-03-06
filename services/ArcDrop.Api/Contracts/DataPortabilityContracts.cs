namespace ArcDrop.Api.Contracts;

/// <summary>
/// Enumerates supported bookmark data exchange formats.
/// Each format balances fidelity and interoperability differently:
/// JSON preserves full structure, CSV is flat and spreadsheet-friendly,
/// HTML follows the Netscape Bookmark File Format for browser import compatibility.
/// </summary>
public enum ExportFormat
{
    Json,
    Csv,
    Html
}

/// <summary>
/// Represents a request to export bookmarks and their collection associations.
/// When CollectionIds is null, all bookmarks are exported.
/// When CollectionIds is an empty array, only unassigned bookmarks are exported.
/// When CollectionIds contains specific IDs, only bookmarks in those collections are exported.
/// </summary>
/// <param name="Format">Target serialization format for the exported file.</param>
/// <param name="CollectionIds">
/// Optional filter: null = all bookmarks, empty = unassigned only,
/// populated = bookmarks belonging to specified collections.
/// </param>
public sealed record ExportBookmarksRequest(ExportFormat Format, IReadOnlyList<Guid>? CollectionIds);

/// <summary>
/// Represents the multipart import form accepted by the bookmark import endpoint.
/// This contract exists for OpenAPI metadata so Scalar can describe the file upload shape accurately.
/// </summary>
/// <param name="Format">Optional format hint used when the uploaded file extension is ambiguous.</param>
/// <param name="File">Bookmark file payload uploaded as multipart form data.</param>
public sealed record ImportBookmarksMultipartRequest(string? Format, IFormFile File);

/// <summary>
/// Represents a single bookmark entry within a portable export/import payload.
/// Uses collection names instead of IDs so the file is transferable across ArcDrop instances.
/// </summary>
public sealed record PortableBookmarkEntry(
    string Url,
    string Title,
    string? Summary,
    DateTimeOffset CreatedAtUtc,
    IReadOnlyList<string> CollectionNames);

/// <summary>
/// Represents a single collection entry within a portable export/import payload.
/// ParentName is used instead of ParentId to enable cross-instance portability.
/// </summary>
public sealed record PortableCollectionEntry(
    string Name,
    string? Description,
    string? ParentName);

/// <summary>
/// Top-level JSON envelope for bookmark export files.
/// Includes format version for forward-compatible schema evolution.
/// </summary>
public sealed record BookmarkExportEnvelope(
    string Version,
    DateTimeOffset ExportedAtUtc,
    IReadOnlyList<PortableCollectionEntry> Collections,
    IReadOnlyList<PortableBookmarkEntry> Bookmarks);

/// <summary>
/// Represents a summary of an import operation outcome.
/// Counts are provided so operators can verify data integrity after bulk imports.
/// </summary>
public sealed record ImportBookmarksResponse(
    int CollectionsCreated,
    int BookmarksCreated,
    int BookmarksUpdated,
    int BookmarksSkipped,
    IReadOnlyList<string> Warnings);
