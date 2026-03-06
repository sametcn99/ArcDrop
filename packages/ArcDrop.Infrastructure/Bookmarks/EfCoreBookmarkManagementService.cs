using ArcDrop.Application.Bookmarks;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Infrastructure.Bookmarks;

/// <summary>
/// Executes bookmark CRUD and membership workflows against the EF Core persistence model.
/// The service centralizes ArcDrop bookmark data access so API endpoints remain thin transport adapters.
/// </summary>
public sealed class EfCoreBookmarkManagementService(
    ArcDropDbContext dbContext,
    ILogger<EfCoreBookmarkManagementService> logger) : IBookmarkManagementService
{
    /// <inheritdoc />
    public async Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(CancellationToken cancellationToken)
    {
        var bookmarks = await dbContext.Bookmarks
            .AsNoTracking()
            .OrderByDescending(x => x.UpdatedAtUtc)
            .Take(200)
            .Select(x => new BookmarkListItem(
                x.Id,
                x.Url,
                x.Title,
                x.Summary,
                x.UpdatedAtUtc,
                x.CreatedAtUtc,
                x.Collections.Select(link => link.CollectionId).ToList()))
            .ToListAsync(cancellationToken);

        return bookmarks;
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks
            .AsNoTracking()
            .Include(x => x.Collections)
            .SingleOrDefaultAsync(x => x.Id == id, cancellationToken);

        return bookmark is null ? null : MapDetail(bookmark);
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem> CreateBookmarkAsync(CreateBookmarkInput input, CancellationToken cancellationToken)
    {
        var utcNow = DateTimeOffset.UtcNow;
        var bookmark = new Bookmark
        {
            Id = Guid.NewGuid(),
            Url = input.Url.Trim(),
            Title = input.Title.Trim(),
            Summary = string.IsNullOrWhiteSpace(input.Summary) ? null : input.Summary.Trim(),
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

        dbContext.Bookmarks.Add(bookmark);
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Created bookmark {BookmarkId} for URL {BookmarkUrl}.", bookmark.Id, bookmark.Url);
        return MapDetail(bookmark);
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem?> UpdateBookmarkAsync(UpdateBookmarkInput input, CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks
            .Include(x => x.Collections)
            .SingleOrDefaultAsync(x => x.Id == input.Id, cancellationToken);

        if (bookmark is null)
        {
            logger.LogWarning("Bookmark update requested for missing bookmark {BookmarkId}.", input.Id);
            return null;
        }

        bookmark.Url = input.Url.Trim();
        bookmark.Title = input.Title.Trim();
        bookmark.Summary = string.IsNullOrWhiteSpace(input.Summary) ? null : input.Summary.Trim();
        bookmark.UpdatedAtUtc = DateTimeOffset.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapDetail(bookmark);
    }

    /// <inheritdoc />
    public async Task<BookmarkCollectionSyncResult> SyncCollectionsAsync(
        Guid bookmarkId,
        IReadOnlyList<Guid> collectionIds,
        CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks
            .Include(x => x.Collections)
            .SingleOrDefaultAsync(x => x.Id == bookmarkId, cancellationToken);

        if (bookmark is null)
        {
            logger.LogWarning("Bookmark collection sync requested for missing bookmark {BookmarkId}.", bookmarkId);
            return new BookmarkCollectionSyncResult(false, false, null);
        }

        var targetCollectionIds = collectionIds
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
                logger.LogWarning(
                    "Bookmark collection sync rejected for bookmark {BookmarkId} because one or more collection identifiers were not found.",
                    bookmarkId);
                return new BookmarkCollectionSyncResult(true, false, null);
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

        return new BookmarkCollectionSyncResult(true, true, MapDetail(bookmark));
    }

    /// <inheritdoc />
    public async Task<bool> DeleteBookmarkAsync(Guid id, CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks.SingleOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (bookmark is null)
        {
            logger.LogWarning("Bookmark delete requested for missing bookmark {BookmarkId}.", id);
            return false;
        }

        dbContext.Bookmarks.Remove(bookmark);
        await dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private static BookmarkDetailItem MapDetail(Bookmark bookmark)
    {
        return new BookmarkDetailItem(
            bookmark.Id,
            bookmark.Url,
            bookmark.Title,
            bookmark.Summary,
            bookmark.CreatedAtUtc,
            bookmark.UpdatedAtUtc,
            bookmark.Collections
                .Select(link => link.CollectionId)
                .OrderBy(collectionId => collectionId)
                .ToList());
    }
}