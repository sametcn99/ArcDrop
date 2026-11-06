namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents a bookmark creation request payload.
/// This contract is intentionally minimal for initial CRUD bootstrap and can be extended
/// with validation metadata as additional flows are introduced.
/// </summary>
/// <param name="Url">Absolute URL that should be stored as bookmark target.</param>
/// <param name="Title">Display title used in list and detail views.</param>
/// <param name="Summary">Optional descriptive text for context and AI cleanup workflows.</param>
/// <param name="Tags">Optional exact tag name set assigned to the new bookmark.</param>
public sealed record CreateBookmarkRequest(string Url, string Title, string? Summary, IReadOnlyList<string>? Tags = null);

/// <summary>
/// Represents a bookmark update request payload.
/// </summary>
/// <param name="Url">Updated bookmark URL.</param>
/// <param name="Title">Updated bookmark title.</param>
/// <param name="Summary">Updated optional summary text.</param>
/// <param name="Tags">Optional replacement tag name set; omit to keep existing tags unchanged.</param>
public sealed record UpdateBookmarkRequest(string Url, string Title, string? Summary, IReadOnlyList<string>? Tags = null);

/// <summary>
/// Represents a bookmark response contract returned by API endpoints.
/// </summary>
public sealed record BookmarkResponse(
    Guid Id,
    string Url,
    string Title,
    string? Summary,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<Guid> CollectionIds,
    IReadOnlyList<string> Tags);

/// <summary>
/// Represents one page of bookmark results with paging metadata for scalable list views.
/// </summary>
public sealed record BookmarkListResponse(
    IReadOnlyList<BookmarkResponse> Items,
    int TotalCount,
    int Page,
    int PageSize);

/// <summary>
/// Represents lightweight bookmark counters used by navigation surfaces.
/// </summary>
public sealed record BookmarkStatsResponse(int TotalCount, int UnassignedCount);

/// <summary>
/// Represents a bookmark tag membership synchronization request.
/// </summary>
/// <param name="Tags">Exact tag name set the bookmark should carry after the sync.</param>
public sealed record SyncBookmarkTagsRequest(IReadOnlyList<string>? Tags);

/// <summary>
/// Represents a tag response entry with usage counts for tag pickers and filters.
/// </summary>
public sealed record TagResponse(Guid Id, string Name, int BookmarkCount);
