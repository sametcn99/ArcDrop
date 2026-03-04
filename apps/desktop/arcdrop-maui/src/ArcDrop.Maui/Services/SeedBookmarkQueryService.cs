using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Maui.Services;

/// <summary>
/// Provides deterministic in-memory bookmark data for early UI workflow validation.
/// This adapter intentionally avoids network dependencies while shell flows are stabilized.
/// </summary>
public sealed class SeedBookmarkQueryService : IBookmarkQueryService
{
    private static readonly DateTimeOffset SeedReferenceUtc = DateTimeOffset.UtcNow;

    private static readonly IReadOnlyList<BookmarkListItem> SeedItems =
    [
        new BookmarkListItem(Guid.Parse("2f8a1e95-cc6e-42cd-84ef-8d7bda0ea6d1"), "https://learn.microsoft.com/dotnet/maui", "MAUI Documentation", "Official .NET MAUI guides and platform setup documentation.", SeedReferenceUtc.AddHours(-2)),
        new BookmarkListItem(Guid.Parse("c2f86417-fd4d-46e3-a8f3-f0db6cff88bb"), "https://github.com/dotnet/aspnetcore", "ASP.NET Core Repository", "Runtime and framework source code for ASP.NET Core.", SeedReferenceUtc.AddDays(-1)),
        new BookmarkListItem(Guid.Parse("f98f8b40-74f6-46a6-a2aa-949f7d4f2f53"), "https://vitepress.dev", "VitePress", "Static documentation site generator used by ArcDrop docs.", SeedReferenceUtc.AddDays(-3)),
        new BookmarkListItem(Guid.Parse("01b74ec6-d975-4e53-bc58-1d7098ff7fb2"), "https://www.postgresql.org/docs/", "PostgreSQL Docs", "Relational database documentation and indexing guidance.", SeedReferenceUtc.AddHours(-10))
    ];

    /// <inheritdoc />
    public Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(string? searchTerm, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(searchTerm))
        {
            return Task.FromResult(SeedItems);
        }

        var normalized = searchTerm.Trim();

        // Filtering keeps behavior explicit and deterministic for early FR-004 list and search flows.
        var filtered = SeedItems
            .Where(item =>
                item.Title.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                item.Url.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                (item.Summary?.Contains(normalized, StringComparison.OrdinalIgnoreCase) ?? false))
            .ToList();

        return Task.FromResult<IReadOnlyList<BookmarkListItem>>(filtered);
    }

    /// <inheritdoc />
    public Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var item = SeedItems.SingleOrDefault(x => x.Id == id);
        if (item is null)
        {
            return Task.FromResult<BookmarkDetailItem?>(null);
        }

        var detail = new BookmarkDetailItem(
            item.Id,
            item.Url,
            item.Title,
            item.Summary,
            item.UpdatedAtUtc.AddDays(-7),
            item.UpdatedAtUtc);

        return Task.FromResult<BookmarkDetailItem?>(detail);
    }
}
