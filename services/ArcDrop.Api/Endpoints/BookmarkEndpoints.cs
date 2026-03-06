using ArcDrop.Api.Contracts;
using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers bookmark CRUD and collection membership synchronization endpoints.
/// </summary>
internal static class BookmarkEndpoints
{
    public static void MapBookmarks(WebApplication app)
    {
        var bookmarksGroup = app.MapGroup("/api/bookmarks").WithTags("Bookmarks");

        bookmarksGroup.MapGet("/", async (IBookmarkManagementService bookmarkService, CancellationToken cancellationToken) =>
        {
            var bookmarks = await bookmarkService.GetBookmarksAsync(cancellationToken);
            return Results.Ok(bookmarks.Select(MapListResponse).ToList());
        })
        .WithName("ListBookmarks")
        .WithSummary("Lists bookmarks.")
        .WithDescription("Returns the latest bookmark rows ordered for operator-facing list views, including collection membership identifiers.")
        .Produces<List<BookmarkResponse>>(StatusCodes.Status200OK);

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
        .WithDescription("Looks up one bookmark by identifier and returns detail data with collection assignments.")
        .Produces<BookmarkResponse>(StatusCodes.Status200OK)
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
                new CreateBookmarkInput(request.Url, request.Title, request.Summary),
                cancellationToken);

            return Results.Created($"/api/bookmarks/{bookmark.Id}", MapDetailResponse(bookmark));
        })
        .WithName("CreateBookmark")
        .WithSummary("Creates a bookmark.")
        .WithDescription("Validates the incoming bookmark payload and stores a new bookmark for FR-004 bookmark management flows.")
        .Accepts<CreateBookmarkRequest>("application/json")
        .Produces<BookmarkResponse>(StatusCodes.Status201Created)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest);

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
                new UpdateBookmarkInput(id, request.Url, request.Title, request.Summary),
                cancellationToken);
            if (bookmark is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(MapDetailResponse(bookmark));
        })
        .WithName("UpdateBookmark")
        .WithSummary("Updates a bookmark.")
        .WithDescription("Replaces the bookmark URL, title, and summary for an existing bookmark identified by its ID.")
        .Accepts<UpdateBookmarkRequest>("application/json")
        .Produces<BookmarkResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
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
            bookmark.CollectionIds ?? []);
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
            bookmark.CollectionIds ?? []);
    }
}
