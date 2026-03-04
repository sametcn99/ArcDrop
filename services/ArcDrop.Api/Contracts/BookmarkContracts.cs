namespace ArcDrop.Api.Contracts;

/// <summary>
/// Represents a bookmark creation request payload.
/// This contract is intentionally minimal for initial CRUD bootstrap and can be extended
/// with validation metadata as additional flows are introduced.
/// </summary>
/// <param name="Url">Absolute URL that should be stored as bookmark target.</param>
/// <param name="Title">Display title used in list and detail views.</param>
/// <param name="Summary">Optional descriptive text for context and AI cleanup workflows.</param>
public sealed record CreateBookmarkRequest(string Url, string Title, string? Summary);

/// <summary>
/// Represents a bookmark update request payload.
/// </summary>
/// <param name="Url">Updated bookmark URL.</param>
/// <param name="Title">Updated bookmark title.</param>
/// <param name="Summary">Updated optional summary text.</param>
public sealed record UpdateBookmarkRequest(string Url, string Title, string? Summary);

/// <summary>
/// Represents a bookmark response contract returned by API endpoints.
/// </summary>
public sealed record BookmarkResponse(
    Guid Id,
    string Url,
    string Title,
    string? Summary,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);
