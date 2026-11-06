using ArcDrop.Api.Contracts;
using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers bookmark CRUD, tag, paged query, and collection membership synchronization endpoints.
/// </summary>
internal static class BookmarkEndpoints
{
    public static void MapBookmarks(WebApplication app)
    {
        var bookmarksGroup = app.MapGroup("/api/bookmarks")
            .WithTags("Bookmarks")
            .RequireAuthorization();

        bookmarksGroup.MapGet("/", async (
            string? search,
            Guid? collectionId,
            bool? unassignedOnly,
            string? tag,
            string? sort,
            int? page,
            int? pageSize,
            IBookmarkManagementService bookmarkService,
            CancellationToken cancellationToken) =>
        {
            var result = await bookmarkService.GetBookmarksAsync(
                new BookmarkListQuery(search, collectionId, unassignedOnly, tag, sort, page ?? 1, pageSize ?? 50),
                cancellationToken);

            return Results.Ok(new BookmarkListResponse(
                result.Items.Select(MapListResponse).ToList(),
                result.TotalCount,
                result.Page,
                result.PageSize));
        })
        .WithName("ListBookmarks")
        .WithSummary("Lists bookmarks with server-side search, filtering, sorting, and paging.")
        .WithDescription("Returns one page of bookmarks. Supported query parameters: search (matches title, URL, summary, and tag names), collectionId, unassignedOnly, tag (exact case-insensitive tag match), sort (updated, created, title), page, and pageSize (max 200). Implements FR-004 list flows and NFR-003 scale targets.")
        .Produces<BookmarkListResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized);

        bookmarksGroup.MapGet("/stats", async (IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            var stats = await bookmarkService.GetBookmarkStatsAsync(cancellationToken);
            return Results.Ok(new BookmarkStatsResponse(stats.TotalCount, stats.UnassignedCount));
        })
        .WithName("GetBookmarkStats")
        .WithSummary("Returns bookmark counters.")
        .WithDescription("Returns total and unassigned bookmark counts used by navigation and dashboard surfaces.")
        .Produces<BookmarkStatsResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized);

        bookmarksGroup.MapGet("/tags", async (IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            var tags = await bookmarkService.GetTagsAsync(cancellationToken);
            return Results.Ok(tags.Select(tag => new TagResponse(tag.Id, tag.Name, tag.BookmarkCount)).ToList());
        })
        .WithName("ListTags")
        .WithSummary("Lists tags with usage counts.")
        .WithDescription("Returns every tag ordered by name together with the number of bookmarks carrying it.")
        .Produces<List<TagResponse>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized);

        bookmarksGroup.MapGet("/{id:guid}", async (Guid id, IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            var bookmark = await bookmarkService.GetBookmarkByIdAsync(id, cancellationToken);

            if (bookmark is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(MapDetailResponse(bookmark));
        })
        .WithName("GetBookmarkById")
        .WithSummary("Returns one bookmark.")
        .WithDescription("Looks up one bookmark by identifier and returns detail data with collection assignments and tags.")
        .Produces<BookmarkResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status404NotFound);

        bookmarksGroup.MapPost("/", async (CreateBookmarkRequest request, IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Url)] = ["A valid absolute URL is required."]
                });
            }

            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Title)] = ["Title is required."]
                });
            }

            var bookmark = await bookmarkService.CreateBookmarkAsync(
                new CreateBookmarkInput(request.Url, request.Title, request.Summary, request.Tags ?? []),
                cancellationToken);

            return Results.Created($"/api/bookmarks/{bookmark.Id}", MapDetailResponse(bookmark));
        })
        .WithName("CreateBookmark")
        .WithSummary("Creates a bookmark.")
        .WithDescription("Validates the incoming bookmark payload, stores a new bookmark, and assigns the supplied tag set for FR-004 bookmark management flows.")
        .Accepts<CreateBookmarkRequest>("application/json")
        .Produces<BookmarkResponse>(StatusCodes.Status201Created)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized);

        bookmarksGroup.MapPut("/{id:guid}", async (Guid id, UpdateBookmarkRequest request, IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Url)] = ["A valid absolute URL is required."]
                });
            }

            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Title)] = ["Title is required."]
                });
            }

            var bookmark = await bookmarkService.UpdateBookmarkAsync(
                new UpdateBookmarkInput(id, request.Url, request.Title, request.Summary, request.Tags),
                cancellationToken);
            if (bookmark is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(MapDetailResponse(bookmark));
        })
        .WithName("UpdateBookmark")
        .WithSummary("Updates a bookmark.")
        .WithDescription("Replaces the bookmark URL, title, and summary for an existing bookmark identified by its ID. Supplying tags replaces the tag set; omitting tags keeps existing assignments.")
        .Accepts<UpdateBookmarkRequest>("application/json")
        .Produces<BookmarkResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status404NotFound);

        bookmarksGroup.MapPut("/{id:guid}/collections", async (
            Guid id,
            SyncBookmarkCollectionsRequest request,
            IBookmarkManagementService bookmarkService,
            CancellationToken cancellationToken) =>
        {
            var result = await bookmarkService.SyncCollectionsAsync(id, request.CollectionIds ?? [], cancellationToken);

            if (!result.BookmarkFound)
            {
                return Results.NotFound();
            }

            if (!result.AllCollectionsFound)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.CollectionIds)] = ["One or more collection IDs were not found."]
                });
            }

            return Results.Ok(MapDetailResponse(result.Bookmark!));
        })
        .WithName("SyncBookmarkCollections")
        .WithSummary("Synchronizes bookmark collection membership.")
        .WithDescription("Adds and removes collection links so the bookmark matches the supplied collection ID set exactly.")
        .Accepts<SyncBookmarkCollectionsRequest>("application/json")
        .Produces<BookmarkResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status404NotFound);

        bookmarksGroup.MapPut("/{id:guid}/tags", async (
            Guid id,
            SyncBookmarkTagsRequest request,
            IBookmarkManagementService bookmarkService,
            CancellationToken cancellationToken) =>
        {
            var bookmark = await bookmarkService.SyncTagsAsync(id, request.Tags ?? [], cancellationToken);

            if (bookmark is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(MapDetailResponse(bookmark));
        })
        .WithName("SyncBookmarkTags")
        .WithSummary("Synchronizes bookmark tag assignments.")
        .WithDescription("Adds and removes tag links so the bookmark matches the supplied tag name set exactly. Missing tags are created on demand.")
        .Accepts<SyncBookmarkTagsRequest>("application/json")
        .Produces<BookmarkResponse>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status404NotFound);

        bookmarksGroup.MapDelete("/{id:guid}", async (Guid id, IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            var deleted = await bookmarkService.DeleteBookmarkAsync(id, cancellationToken);
            if (!deleted)
            {
                return Results.NotFound();
            }

            return Results.NoContent();
        })
        .WithName("DeleteBookmark")
        .WithSummary("Deletes a bookmark.")
        .WithDescription("Removes one bookmark by identifier and returns no content when the deletion succeeds.")
        .Produces(StatusCodes.Status204NoContent)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status404NotFound);
    }

    private static BookmarkResponse MapDetailResponse(BookmarkDetailItem bookmark)
    {
        return new BookmarkResponse(
            bookmark.Id,
            bookmark.Url,
            bookmark.Title,
            bookmark.Summary,
            bookmark.CreatedAtUtc,
            bookmark.UpdatedAtUtc,
            bookmark.CollectionIds ?? [],
            bookmark.Tags ?? []);
    }

    private static BookmarkResponse MapListResponse(BookmarkListItem bookmark)
    {
        return new BookmarkResponse(
            bookmark.Id,
            bookmark.Url,
            bookmark.Title,
            bookmark.Summary,
            bookmark.CreatedAtUtc ?? DateTimeOffset.MinValue,
            bookmark.UpdatedAtUtc,
            bookmark.CollectionIds ?? [],
            bookmark.Tags ?? []);
    }
}
