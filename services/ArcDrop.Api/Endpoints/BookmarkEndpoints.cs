using ArcDrop.Api.Contracts;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers bookmark CRUD and collection membership synchronization endpoints.
/// </summary>
internal static class BookmarkEndpoints
{
    public static void MapBookmarks(WebApplication app)
    {
        var bookmarksGroup = app.MapGroup("/api/bookmarks");

        bookmarksGroup.MapGet("/", async (ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var bookmarks = await dbContext.Bookmarks
                .AsNoTracking()
                .OrderByDescending(x => x.UpdatedAtUtc)
                .Take(200)
                .Select(x => new BookmarkResponse(
                    x.Id,
                    x.Url,
                    x.Title,
                    x.Summary,
                    x.CreatedAtUtc,
                    x.UpdatedAtUtc,
                    x.Collections
                        .Select(link => link.CollectionId)
                        .ToList()))
                .ToListAsync(cancellationToken);

            return Results.Ok(bookmarks);
        });

        bookmarksGroup.MapGet("/{id:guid}", async (Guid id, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var bookmark = await dbContext.Bookmarks
                .AsNoTracking()
                .Include(x => x.Collections)
                .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

            if (bookmark is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(new BookmarkResponse(
                bookmark.Id,
                bookmark.Url,
                bookmark.Title,
                bookmark.Summary,
                bookmark.CreatedAtUtc,
                bookmark.UpdatedAtUtc,
                bookmark.Collections
                    .Select(link => link.CollectionId)
                    .ToList()));
        });

        bookmarksGroup.MapPost("/", async (CreateBookmarkRequest request, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
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

            var utcNow = DateTimeOffset.UtcNow;
            var bookmark = new Bookmark
            {
                Id = Guid.NewGuid(),
                Url = request.Url.Trim(),
                Title = request.Title.Trim(),
                Summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary.Trim(),
                CreatedAtUtc = utcNow,
                UpdatedAtUtc = utcNow
            };

            dbContext.Bookmarks.Add(bookmark);
            await dbContext.SaveChangesAsync(cancellationToken);

            var response = new BookmarkResponse(
                bookmark.Id,
                bookmark.Url,
                bookmark.Title,
                bookmark.Summary,
                bookmark.CreatedAtUtc,
                bookmark.UpdatedAtUtc,
                []);

            return Results.Created($"/api/bookmarks/{bookmark.Id}", response);
        });

        bookmarksGroup.MapPut("/{id:guid}", async (Guid id, UpdateBookmarkRequest request, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
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

            var bookmark = await dbContext.Bookmarks
                .Include(x => x.Collections)
                .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
            if (bookmark is null)
            {
                return Results.NotFound();
            }

            bookmark.Url = request.Url.Trim();
            bookmark.Title = request.Title.Trim();
            bookmark.Summary = string.IsNullOrWhiteSpace(request.Summary) ? null : request.Summary.Trim();
            bookmark.UpdatedAtUtc = DateTimeOffset.UtcNow;

            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.Ok(new BookmarkResponse(
                bookmark.Id,
                bookmark.Url,
                bookmark.Title,
                bookmark.Summary,
                bookmark.CreatedAtUtc,
                bookmark.UpdatedAtUtc,
                bookmark.Collections
                    .Select(link => link.CollectionId)
                    .ToList()));
        });

        bookmarksGroup.MapPut("/{id:guid}/collections", async (
            Guid id,
            SyncBookmarkCollectionsRequest request,
            ArcDropDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            var bookmark = await dbContext.Bookmarks
                .Include(x => x.Collections)
                .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

            if (bookmark is null)
            {
                return Results.NotFound();
            }

            var targetCollectionIds = (request.CollectionIds ?? [])
                .Distinct()
                .ToList();

            if (targetCollectionIds.Count > 0)
            {
                var existingCollectionIds = await dbContext.Collections
                    .AsNoTracking()
                    .Where(x => targetCollectionIds.Contains(x.Id))
                    .Select(x => x.Id)
                    .ToListAsync(cancellationToken);

                if (existingCollectionIds.Count != targetCollectionIds.Count)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        [nameof(request.CollectionIds)] = ["One or more collection IDs were not found."]
                    });
                }
            }

            var linksToRemove = bookmark.Collections
                .Where(link => !targetCollectionIds.Contains(link.CollectionId))
                .ToList();

            if (linksToRemove.Count > 0)
            {
                dbContext.BookmarkCollectionLinks.RemoveRange(linksToRemove);
            }

            var existingLinks = bookmark.Collections
                .Select(link => link.CollectionId)
                .ToHashSet();

            foreach (var collectionId in targetCollectionIds.Where(collectionId => !existingLinks.Contains(collectionId)))
            {
                bookmark.Collections.Add(new BookmarkCollectionLink
                {
                    BookmarkId = bookmark.Id,
                    CollectionId = collectionId
                });
            }

            bookmark.UpdatedAtUtc = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.Ok(new BookmarkResponse(
                bookmark.Id,
                bookmark.Url,
                bookmark.Title,
                bookmark.Summary,
                bookmark.CreatedAtUtc,
                bookmark.UpdatedAtUtc,
                bookmark.Collections
                    .Select(link => link.CollectionId)
                    .OrderBy(collectionId => collectionId)
                    .ToList()));
        });

        bookmarksGroup.MapDelete("/{id:guid}", async (Guid id, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var bookmark = await dbContext.Bookmarks.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
            if (bookmark is null)
            {
                return Results.NotFound();
            }

            dbContext.Bookmarks.Remove(bookmark);
            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.NoContent();
        });
    }
}
