using System.ComponentModel.DataAnnotations;

namespace ArcDrop.Web.Services;

/// <summary>
/// Represents bookmark payload projection used by the Blazor web host.
/// </summary>
public sealed record BookmarkDto(
    Guid Id,
    string Url,
    string Title,
    string? Summary,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<Guid> CollectionIds);

/// <summary>
/// Represents a collection node used by list and tree views in the web client.
/// </summary>
public sealed record CollectionDto(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Represents a lightweight bookmark projection nested under collection tree nodes.
/// </summary>
public sealed record CollectionBookmarkItemDto(Guid Id, string Title, string Url, DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Represents a recursive collection tree response.
/// </summary>
public sealed record CollectionTreeNodeDto(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    IReadOnlyList<CollectionBookmarkItemDto> Bookmarks,
    IReadOnlyList<CollectionTreeNodeDto> Children);

/// <summary>
/// Represents create bookmark request payload submitted from web forms.
/// </summary>
public sealed class CreateBookmarkRequest
{
    [Required]
    [Url]
    public string Url { get; set; } = string.Empty;

    [Required]
    public string Title { get; set; } = string.Empty;

    public string? Summary { get; set; }
}

/// <summary>
/// Represents update bookmark request payload submitted from web forms.
/// </summary>
public sealed class UpdateBookmarkRequest
{
    [Required]
    [Url]
    public string Url { get; set; } = string.Empty;

    [Required]
    public string Title { get; set; } = string.Empty;

    public string? Summary { get; set; }
}

/// <summary>
/// Represents create collection request payload submitted from web forms.
/// </summary>
public sealed class CreateCollectionRequest
{
    [Required]
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public Guid? ParentId { get; set; }
}

/// <summary>
/// Represents update collection request payload submitted from web forms.
/// </summary>
public sealed class UpdateCollectionRequest
{
    [Required]
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public Guid? ParentId { get; set; }
}

/// <summary>
/// Represents one bookmark-to-collections synchronization request.
/// </summary>
public sealed class SyncBookmarkCollectionsRequest
{
    [Required]
    public IReadOnlyList<Guid> CollectionIds { get; set; } = [];
}

/// <summary>
/// Represents fixed-admin login request credentials.
/// </summary>
public sealed class LoginRequest
{
    [Required]
    public string Username { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}

/// <summary>
/// Represents a successful login response containing access token metadata.
/// </summary>
public sealed record LoginResponse(string AccessToken, DateTimeOffset ExpiresAtUtc);

/// <summary>
/// Represents the authenticated admin profile projection.
/// </summary>
public sealed record CurrentAdminResponse(string Username, bool Authenticated);

/// <summary>
/// Represents password rotation request payload for the fixed-admin account.
/// </summary>
public sealed class RotateAdminPasswordRequest
{
    [Required]
    public string CurrentPassword { get; set; } = string.Empty;

    [Required]
    [MinLength(12)]
    public string NewPassword { get; set; } = string.Empty;
}

/// <summary>
/// Represents create or update input for an AI provider configuration profile.
/// </summary>
public sealed class UpsertAiProviderConfigRequest
{
    [Required]
    public string ProviderName { get; set; } = string.Empty;

    [Required]
    [Url]
    public string ApiEndpoint { get; set; } = string.Empty;

    [Required]
    public string Model { get; set; } = string.Empty;

    [Required]
    public string ApiKey { get; set; } = string.Empty;
}

/// <summary>
/// Represents mutable fields for an existing AI provider profile.
/// </summary>
public sealed class UpdateAiProviderConfigRequest
{
    [Required]
    [Url]
    public string ApiEndpoint { get; set; } = string.Empty;

    [Required]
    public string Model { get; set; } = string.Empty;

    public string? ApiKey { get; set; }
}

/// <summary>
/// Represents AI provider configuration output with masked secret metadata.
/// </summary>
public sealed record AiProviderConfigResponse(
    Guid Id,
    string ProviderName,
    string ApiEndpoint,
    string Model,
    bool HasApiKey,
    string ApiKeyPreview,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc);

/// <summary>
/// Represents one bookmark organization command request.
/// </summary>
public sealed class OrganizeBookmarkRequest
{
    [Required]
    public string ProviderName { get; set; } = string.Empty;

    [Required]
    public string OperationType { get; set; } = string.Empty;

    [Required]
    [Url]
    public string BookmarkUrl { get; set; } = string.Empty;

    [Required]
    public string BookmarkTitle { get; set; } = string.Empty;

    public string? BookmarkSummary { get; set; }
}

/// <summary>
/// Represents one AI suggestion item generated by an organization operation.
/// </summary>
public sealed record AiOperationResultResponse(string ResultType, string Value, decimal? Confidence);

/// <summary>
/// Represents one AI organization operation response envelope.
/// </summary>
public sealed record OrganizeBookmarkResponse(
    Guid OperationId,
    string ProviderName,
    string OperationType,
    string OutcomeStatus,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc,
    IReadOnlyList<AiOperationResultResponse> Results);

/// <summary>
/// Enumerates supported bookmark data exchange formats for export and import operations.
/// </summary>
public enum ExportFormat
{
    Json,
    Csv,
    Html
}

/// <summary>
/// Represents the request payload for exporting bookmarks.
/// CollectionIds controls scope: null = all, empty = unassigned, populated = specific collections.
/// </summary>
public sealed class ExportBookmarksRequest
{
    [Required]
    public ExportFormat Format { get; set; } = ExportFormat.Json;

    public IReadOnlyList<Guid>? CollectionIds { get; set; }
}

/// <summary>
/// Represents the response payload summarizing an import operation outcome.
/// </summary>
public sealed record ImportBookmarksResponse(
    int CollectionsCreated,
    int BookmarksCreated,
    int BookmarksUpdated,
    int BookmarksSkipped,
    IReadOnlyList<string> Warnings);
