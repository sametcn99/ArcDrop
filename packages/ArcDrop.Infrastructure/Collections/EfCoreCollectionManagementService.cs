using ArcDrop.Application.Collections;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Infrastructure.Collections;

/// <summary>
/// Executes collection CRUD and hierarchy workflows against the EF Core persistence model.
/// </summary>
public sealed class EfCoreCollectionManagementService(
    ArcDropDbContext dbContext,
    ILogger<EfCoreCollectionManagementService> logger) : ICollectionManagementService
{
    /// <inheritdoc />
    public async Task<IReadOnlyList<CollectionItem>> GetCollectionsAsync(CancellationToken cancellationToken)
    {
        return await dbContext.Collections
            .AsNoTracking()
            .OrderBy(x => x.Name)
            .Select(x => new CollectionItem(
                x.Id,
                x.Name,
                x.Description,
                x.ParentId,
                x.CreatedAtUtc,
                x.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<CollectionTreeNodeItem>> GetCollectionTreeAsync(CancellationToken cancellationToken)
    {
        var collections = await dbContext.Collections
            .AsNoTracking()
            .Include(x => x.Bookmarks)
            .ThenInclude(link => link.Bookmark)
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        return BuildCollectionTree(collections);
    }

    /// <inheritdoc />
    public async Task<CollectionMutationResult> CreateCollectionAsync(CreateCollectionInput input, CancellationToken cancellationToken)
    {
        var trimmedName = input.Name.Trim();
        var duplicateExists = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(x => x.Name == trimmedName, cancellationToken);

        if (duplicateExists)
        {
            return new CollectionMutationResult(null, nameof(input.Name), "Collection name must be unique.");
        }

        if (input.ParentId.HasValue)
        {
            var parentExists = await dbContext.Collections
                .AsNoTracking()
                .AnyAsync(x => x.Id == input.ParentId.Value, cancellationToken);

            if (!parentExists)
            {
                return new CollectionMutationResult(null, nameof(input.ParentId), "Parent collection was not found.");
            }
        }

        var utcNow = DateTimeOffset.UtcNow;
        var collection = new Collection
        {
            Id = Guid.NewGuid(),
            Name = trimmedName,
            Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim(),
            ParentId = input.ParentId,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

        dbContext.Collections.Add(collection);
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Created collection {CollectionId} with name {CollectionName}.", collection.Id, collection.Name);
        return new CollectionMutationResult(MapCollection(collection), null, null);
    }

    /// <inheritdoc />
    public async Task<CollectionMutationResult> UpdateCollectionAsync(UpdateCollectionInput input, CancellationToken cancellationToken)
    {
        var collection = await dbContext.Collections
            .SingleOrDefaultAsync(x => x.Id == input.Id, cancellationToken);

        if (collection is null)
        {
            return new CollectionMutationResult(null, null, null, NotFound: true);
        }

        if (input.ParentId == input.Id)
        {
            return new CollectionMutationResult(null, nameof(input.ParentId), "Collection cannot be its own parent.");
        }

        if (input.ParentId.HasValue)
        {
            var parentCandidate = await dbContext.Collections
                .AsNoTracking()
                .SingleOrDefaultAsync(x => x.Id == input.ParentId.Value, cancellationToken);

            if (parentCandidate is null)
            {
                return new CollectionMutationResult(null, nameof(input.ParentId), "Parent collection was not found.");
            }

            var hierarchyItems = await dbContext.Collections
                .AsNoTracking()
                .Select(x => new CollectionHierarchyRecord(x.Id, x.ParentId))
                .ToListAsync(cancellationToken);

            if (CollectionHierarchyCycleDetector.WouldCreateCycle(
                input.Id,
                input.ParentId.Value,
                hierarchyItems.Select(x => (x.Id, x.ParentId)).ToList()))
            {
                return new CollectionMutationResult(null, nameof(input.ParentId), "Parent collection would create a cycle.");
            }
        }

        var normalizedName = input.Name.Trim();
        var duplicateExists = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(x => x.Id != input.Id && x.Name == normalizedName, cancellationToken);

        if (duplicateExists)
        {
            return new CollectionMutationResult(null, nameof(input.Name), "Collection name must be unique.");
        }

        collection.Name = normalizedName;
        collection.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
        collection.ParentId = input.ParentId;
        collection.UpdatedAtUtc = DateTimeOffset.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return new CollectionMutationResult(MapCollection(collection), null, null);
    }

    /// <inheritdoc />
    public async Task<CollectionDeleteResult> DeleteCollectionAsync(Guid id, CancellationToken cancellationToken)
    {
        var collection = await dbContext.Collections
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (collection is null)
        {
            return new CollectionDeleteResult(false, true, null, null);
        }

        var hasChildren = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(x => x.ParentId == id, cancellationToken);

        if (hasChildren)
        {
            return new CollectionDeleteResult(false, false, "collection", "Delete child collections first.");
        }

        dbContext.Collections.Remove(collection);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new CollectionDeleteResult(true, false, null, null);
    }

    private static CollectionItem MapCollection(Collection collection)
    {
        return new CollectionItem(
            collection.Id,
            collection.Name,
            collection.Description,
            collection.ParentId,
            collection.CreatedAtUtc,
            collection.UpdatedAtUtc);
    }

    private static IReadOnlyList<CollectionTreeNodeItem> BuildCollectionTree(IReadOnlyList<Collection> collections)
    {
        var childrenByParentId = collections.ToLookup(x => x.ParentId);

        CollectionTreeNodeItem BuildNode(Collection collection)
        {
            var bookmarks = collection.Bookmarks
                .Select(link => link.Bookmark)
                .Where(bookmark => bookmark is not null)
                .OrderByDescending(bookmark => bookmark!.UpdatedAtUtc)
                .Select(bookmark => new CollectionBookmarkItem(
                    bookmark!.Id,
                    bookmark.Title,
                    bookmark.Url,
                    bookmark.UpdatedAtUtc))
                .ToList();

            var children = childrenByParentId[collection.Id]
                .OrderBy(item => item.Name)
                .Select(BuildNode)
                .ToList();

            return new CollectionTreeNodeItem(
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

    private readonly record struct CollectionHierarchyRecord(Guid Id, Guid? ParentId);
}