using ArcDrop.Application.Bookmarks;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Infrastructure.Bookmarks;

/// <summary>
/// Executes bookmark CRUD, tag, membership, and paged query workflows against the EF Core persistence model.
/// The service centralizes ArcDrop bookmark data access so API endpoints remain thin transport adapters.
/// </summary>
public sealed class EfCoreBookmarkManagementService(
    ArcDropDbContext dbContext,
    ILogger<EfCoreBookmarkManagementService> logger) : IBookmarkManagementService
{
    /// <inheritdoc />
    public async Task<BookmarkListResult> GetBookmarksAsync(BookmarkListQuery query, CancellationToken cancellationToken)
    {
        var normalized = query.Normalized();
        var bookmarks = dbContext.Bookmarks.AsNoTracking().AsQueryable();

        bookmarks = ApplyFilters(bookmarks, normalized);
        bookmarks = ApplySort(bookmarks, normalized.Sort);

        var totalCount = await bookmarks.CountAsync(cancellationToken);

        var items = await bookmarks
            .Skip((normalized.Page - 1) * normalized.PageSize)
            .Take(normalized.PageSize)
            .Select(x => new BookmarkListItem(
                x.Id,
                x.Url,
                x.Title,
                x.Summary,
                x.UpdatedAtUtc,
                x.CreatedAtUtc,
                x.Collections.Select(link => link.CollectionId).ToList(),
                x.Tags.Select(link => link.Tag.Name).ToList()))
            .ToListAsync(cancellationToken);

        return new BookmarkListResult(items, totalCount, normalized.Page, normalized.PageSize);
    }

    /// <inheritdoc />
    public async Task<BookmarkStats> GetBookmarkStatsAsync(CancellationToken cancellationToken)
    {
        var totalCount = await dbContext.Bookmarks.CountAsync(cancellationToken);
        var assignedBookmarkIds = dbContext.BookmarkCollectionLinks
            .AsNoTracking()
            .Select(link => link.BookmarkId);

        var unassignedCount = await dbContext.Bookmarks
            .AsNoTracking()
            .Where(bookmark => !assignedBookmarkIds.Contains(bookmark.Id))
            .CountAsync(cancellationToken);

        return new BookmarkStats(totalCount, unassignedCount);
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks
            .AsNoTracking()
            .Include(x => x.Collections)
            .Include(x => x.Tags).ThenInclude(link => link.Tag)
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
        await SyncTagLinksAsync(bookmark, input.Tags ?? [], cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Created bookmark {BookmarkId} for URL {BookmarkUrl}.", bookmark.Id, bookmark.Url);
        return MapDetail(bookmark);
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem?> UpdateBookmarkAsync(UpdateBookmarkInput input, CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks
            .Include(x => x.Collections)
            .Include(x => x.Tags).ThenInclude(link => link.Tag)
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

        if (input.Tags is not null)
        {
            await SyncTagLinksAsync(bookmark, input.Tags, cancellationToken);
        }

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
    public async Task<BookmarkDetailItem?> SyncTagsAsync(
        Guid bookmarkId,
        IReadOnlyList<string> tagNames,
        CancellationToken cancellationToken)
    {
        var bookmark = await dbContext.Bookmarks
            .Include(x => x.Collections)
            .Include(x => x.Tags).ThenInclude(link => link.Tag)
            .SingleOrDefaultAsync(x => x.Id == bookmarkId, cancellationToken);

        if (bookmark is null)
        {
            logger.LogWarning("Bookmark tag sync requested for missing bookmark {BookmarkId}.", bookmarkId);
            return null;
        }

        await SyncTagLinksAsync(bookmark, tagNames, cancellationToken);
        bookmark.UpdatedAtUtc = DateTimeOffset.UtcNow;

        await dbContext.SaveChangesAsync(cancellationToken);
        return MapDetail(bookmark);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TagItem>> GetTagsAsync(CancellationToken cancellationToken)
    {
        var tags = await dbContext.Tags
            .AsNoTracking()
            .OrderBy(tag => tag.Name)
            .Select(tag => new TagItem(
                tag.Id,
                tag.Name,
                tag.Bookmarks.Count))
            .ToListAsync(cancellationToken);

        return tags;
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

    private static IQueryable<Domain.Entities.Bookmark> ApplyFilters(
        IQueryable<Domain.Entities.Bookmark> bookmarks,
        BookmarkListQuery query)
    {
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var searchTerm = query.Search.Trim();

            bookmarks = bookmarks.Where(bookmark =>
                bookmark.Title.Contains(searchTerm) ||
                bookmark.Url.Contains(searchTerm) ||
                (bookmark.Summary != null && bookmark.Summary.Contains(searchTerm)) ||
                bookmark.Tags.Any(link => link.Tag.Name.Contains(searchTerm)));
        }

        if (query.CollectionId is { } collectionId)
        {
            bookmarks = bookmarks.Where(bookmark =>
                bookmark.Collections.Any(link => link.CollectionId == collectionId));
        }

        if (!string.IsNullOrWhiteSpace(query.Tag))
        {
            var normalizedTag = query.Tag.Trim().ToLowerInvariant();

            bookmarks = bookmarks.Where(bookmark =>
                bookmark.Tags.Any(link => link.Tag.NameNormalized == normalizedTag));
        }

        if (query.UnassignedOnly == true)
        {
            bookmarks = bookmarks.Where(bookmark => !bookmark.Collections.Any());
        }

        return bookmarks;
    }

    private static IQueryable<Domain.Entities.Bookmark> ApplySort(
        IQueryable<Domain.Entities.Bookmark> bookmarks,
        string? sort)
    {
        return (sort ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "created" => bookmarks.OrderByDescending(bookmark => bookmark.CreatedAtUtc),
            "title" => bookmarks.OrderBy(bookmark => bookmark.Title),
            _ => bookmarks.OrderByDescending(bookmark => bookmark.UpdatedAtUtc)
        };
    }

    /// <summary>
    /// Reconciles the bookmark's tag links so they match the supplied tag name set exactly.
    /// Missing tags are created on demand and tag names are normalized case-insensitively.
    /// </summary>
    private async Task SyncTagLinksAsync(
        Bookmark bookmark,
        IReadOnlyList<string> tagNames,
        CancellationToken cancellationToken)
    {
        var requestedTags = tagNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .GroupBy(name => name.ToLowerInvariant(), StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

        var requestedNormalized = requestedTags
            .Select(name => name.ToLowerInvariant())
            .ToList();

        var linksToRemove = bookmark.Tags
            .Where(link => !requestedNormalized.Contains(link.Tag.NameNormalized))
            .ToList();

        if (linksToRemove.Count > 0)
        {
            dbContext.BookmarkTags.RemoveRange(linksToRemove);
        }

        var existingNormalized = bookmark.Tags
            .Select(link => link.Tag.NameNormalized)
            .ToHashSet();

        var missingNames = requestedTags
            .Where(name => !existingNormalized.Contains(name.ToLowerInvariant()))
            .ToList();

        if (missingNames.Count > 0)
        {
            var missingNormalized = missingNames
                .Select(name => name.ToLowerInvariant())
                .ToList();

            var storedTagNames = await dbContext.Tags
                .AsNoTracking()
                .Where(tag => missingNormalized.Contains(tag.NameNormalized))
                .ToListAsync(cancellationToken);

            var storedByNormalized = storedTagNames
                .ToDictionary(tag => tag.NameNormalized, StringComparer.Ordinal);

            var utcNow = DateTimeOffset.UtcNow;

            foreach (var name in missingNames)
            {
                var normalized = name.ToLowerInvariant();

                if (!storedByNormalized.TryGetValue(normalized, out var tag))
                {
                    tag = new Tag
                    {
                        Id = Guid.NewGuid(),
                        Name = name,
                        NameNormalized = normalized,
                        CreatedAtUtc = utcNow,
                        UpdatedAtUtc = utcNow
                    };

                    dbContext.Tags.Add(tag);
                    storedByNormalized[normalized] = tag;
                }

                bookmark.Tags.Add(new BookmarkTag
                {
                    BookmarkId = bookmark.Id,
                    TagId = tag.Id
                });
            }
        }
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
                .ToList(),
            bookmark.Tags
                .Select(link => link.Tag.Name)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList());
    }
}
