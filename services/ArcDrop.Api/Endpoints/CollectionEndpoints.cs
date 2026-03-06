using ArcDrop.Api.Contracts;
using ArcDrop.Application.Collections;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers collection CRUD and hierarchy endpoints.
/// </summary>
internal static class CollectionEndpoints
{
    public static void MapCollections(WebApplication app)
    {
        var collectionsGroup = app.MapGroup("/api/collections");

        collectionsGroup.MapGet("/", async (ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var collections = await dbContext.Collections
                .AsNoTracking()
                .OrderBy(x => x.Name)
                .Select(x => new CollectionResponse(
                    x.Id,
                    x.Name,
                    x.Description,
                    x.ParentId,
                    x.CreatedAtUtc,
                    x.UpdatedAtUtc))
                .ToListAsync(cancellationToken);

            return Results.Ok(collections);
        });

        collectionsGroup.MapGet("/tree", async (ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var collections = await dbContext.Collections
                .AsNoTracking()
                .Include(x => x.Bookmarks)
                .ThenInclude(link => link.Bookmark)
                .OrderBy(x => x.Name)
                .ToListAsync(cancellationToken);

            var tree = BuildCollectionTreeResponse(collections);
            return Results.Ok(tree);
        });

        collectionsGroup.MapPost("/", async (CreateCollectionRequest request, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Name)] = ["Collection name is required."]
                });
            }

            var trimmedName = request.Name.Trim();
            var duplicateExists = await dbContext.Collections
                .AsNoTracking()
                .AnyAsync(x => x.Name == trimmedName, cancellationToken);

            if (duplicateExists)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Name)] = ["Collection name must be unique."]
                });
            }

            if (request.ParentId.HasValue)
            {
                var parentExists = await dbContext.Collections
                    .AsNoTracking()
                    .AnyAsync(x => x.Id == request.ParentId.Value, cancellationToken);

                if (!parentExists)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        [nameof(request.ParentId)] = ["Parent collection was not found."]
                    });
                }
            }

            var utcNow = DateTimeOffset.UtcNow;
            var collection = new Collection
            {
                Id = Guid.NewGuid(),
                Name = trimmedName,
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                ParentId = request.ParentId,
                CreatedAtUtc = utcNow,
                UpdatedAtUtc = utcNow
            };

            dbContext.Collections.Add(collection);
            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.Created($"/api/collections/{collection.Id}", new CollectionResponse(
                collection.Id,
                collection.Name,
                collection.Description,
                collection.ParentId,
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc));
        });

        collectionsGroup.MapPut("/{id:guid}", async (Guid id, UpdateCollectionRequest request, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Name)] = ["Collection name is required."]
                });
            }

            var collection = await dbContext.Collections
                .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

            if (collection is null)
            {
                return Results.NotFound();
            }

            if (request.ParentId == id)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.ParentId)] = ["Collection cannot be its own parent."]
                });
            }

            if (request.ParentId.HasValue)
            {
                var parentCandidate = await dbContext.Collections
                    .AsNoTracking()
                    .SingleOrDefaultAsync(x => x.Id == request.ParentId.Value, cancellationToken);

                if (parentCandidate is null)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        [nameof(request.ParentId)] = ["Parent collection was not found."]
                    });
                }

                var hierarchyItems = await dbContext.Collections
                    .AsNoTracking()
                    .Select(x => new CollectionHierarchyItem(x.Id, x.ParentId))
                    .ToListAsync(cancellationToken);

                // Delegate cycle detection to application-layer policy to keep endpoint code focused on HTTP concerns.
                if (CollectionHierarchyCycleDetector.WouldCreateCycle(
                    id,
                    request.ParentId.Value,
                    hierarchyItems.Select(x => (x.Id, x.ParentId)).ToList()))
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        [nameof(request.ParentId)] = ["Parent collection would create a cycle."]
                    });
                }
            }

            var normalizedName = request.Name.Trim();
            var duplicateExists = await dbContext.Collections
                .AsNoTracking()
                .AnyAsync(x => x.Id != id && x.Name == normalizedName, cancellationToken);

            if (duplicateExists)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Name)] = ["Collection name must be unique."]
                });
            }

            collection.Name = normalizedName;
            collection.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
            collection.ParentId = request.ParentId;
            collection.UpdatedAtUtc = DateTimeOffset.UtcNow;

            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.Ok(new CollectionResponse(
                collection.Id,
                collection.Name,
                collection.Description,
                collection.ParentId,
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc));
        });

        collectionsGroup.MapDelete("/{id:guid}", async (Guid id, ArcDropDbContext dbContext, CancellationToken cancellationToken) =>
        {
            var collection = await dbContext.Collections
                .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

            if (collection is null)
            {
                return Results.NotFound();
            }

            var hasChildren = await dbContext.Collections
                .AsNoTracking()
                .AnyAsync(x => x.ParentId == id, cancellationToken);

            if (hasChildren)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["collection"] = ["Delete child collections first."]
                });
            }

            dbContext.Collections.Remove(collection);
            await dbContext.SaveChangesAsync(cancellationToken);

            return Results.NoContent();
        });
    }

    private static IReadOnlyList<CollectionTreeNodeResponse> BuildCollectionTreeResponse(IReadOnlyList<Collection> collections)
    {
        var childrenByParentId = collections
            .ToLookup(x => x.ParentId);

        CollectionTreeNodeResponse BuildNode(Collection collection)
        {
            var bookmarks = collection.Bookmarks
                .Select(link => link.Bookmark)
                .Where(bookmark => bookmark is not null)
                .OrderByDescending(bookmark => bookmark.UpdatedAtUtc)
                .Select(bookmark => new CollectionBookmarkItemResponse(
                    bookmark.Id,
                    bookmark.Title,
                    bookmark.Url,
                    bookmark.UpdatedAtUtc))
                .ToList();

            var children = childrenByParentId[collection.Id]
                .OrderBy(item => item.Name)
                .Select(BuildNode)
                .ToList();

            return new CollectionTreeNodeResponse(
                collection.Id,
                collection.Name,
                collection.Description,
                collection.ParentId,
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc,
                bookmarks,
                children);
        }

        return childrenByParentId[null]
            .OrderBy(root => root.Name)
            .Select(BuildNode)
            .ToList();
    }

    private readonly record struct CollectionHierarchyItem(Guid Id, Guid? ParentId);
}
