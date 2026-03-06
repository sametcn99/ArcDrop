using ArcDrop.Application.Portability;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using ArcDrop.Infrastructure.Portability;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Verifies data portability workflow behavior without HTTP transport concerns.
/// These tests protect the new application-layer portability boundary against regression.
/// </summary>
public sealed class DataPortabilityServiceTests
{
    /// <summary>
    /// Ensures collection-scoped exports include ancestor folders so hierarchy can be reconstructed on import.
    /// </summary>
    [Fact]
    public async Task ExportAsync_WithScopedCollection_IncludesAncestorCollections()
    {
        await using var dbContext = CreateDbContext();

        var rootCollection = new Collection
        {
            Id = Guid.NewGuid(),
            Name = "Engineering",
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        var childCollection = new Collection
        {
            Id = Guid.NewGuid(),
            Name = "DotNet",
            ParentId = rootCollection.Id,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        var bookmark = new Bookmark
        {
            Id = Guid.NewGuid(),
            Url = "https://learn.microsoft.com/dotnet",
            Title = "DotNet Docs",
            Summary = "Reference documentation",
            CreatedAtUtc = DateTimeOffset.UtcNow,
            UpdatedAtUtc = DateTimeOffset.UtcNow
        };

        bookmark.Collections.Add(new BookmarkCollectionLink
        {
            BookmarkId = bookmark.Id,
            CollectionId = childCollection.Id
        });

        dbContext.Collections.AddRange(rootCollection, childCollection);
        dbContext.Bookmarks.Add(bookmark);
        await dbContext.SaveChangesAsync();

        var service = new EfCoreDataPortabilityService(dbContext, NullLogger<EfCoreDataPortabilityService>.Instance);

        var exportedFile = await service.ExportAsync(
            new ExportBookmarksInput(DataPortabilityFormat.Json, [childCollection.Id]),
            CancellationToken.None);

        var envelope = JsonSerializer.Deserialize<PortableEnvelope>(exportedFile.Content, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        Assert.NotNull(envelope);
        Assert.Equal("application/json", exportedFile.ContentType);
        Assert.Equal(2, envelope!.Collections.Count);
        Assert.Contains(envelope.Collections, collection => collection.Name == "Engineering");
        Assert.Contains(envelope.Collections, collection => collection.Name == "DotNet" && collection.ParentName == "Engineering");
        Assert.Single(envelope.Bookmarks);
        Assert.Equal("https://learn.microsoft.com/dotnet", envelope.Bookmarks[0].Url);
        Assert.Contains("DotNet", envelope.Bookmarks[0].CollectionNames);
    }

    /// <summary>
    /// Ensures CSV import creates missing collections, persists valid bookmarks, and skips malformed rows safely.
    /// </summary>
    [Fact]
    public async Task ImportAsync_WithCsvPayload_CreatesCollectionsAndSkipsInvalidBookmarks()
    {
        await using var dbContext = CreateDbContext();
        var service = new EfCoreDataPortabilityService(dbContext, NullLogger<EfCoreDataPortabilityService>.Instance);

        var csvContent = string.Join('\n',
            "Url,Title,Summary,CreatedAtUtc,Collections",
            "https://example.com,Example,Seed summary,2026-03-06T10:30:00Z,Research|Docs",
            "notaurl,Broken,Should skip,2026-03-06T10:30:00Z,Research");

        var result = await service.ImportAsync(
            new ImportBookmarksInput(DataPortabilityFormat.Csv, csvContent),
            CancellationToken.None);

        var importedBookmark = await dbContext.Bookmarks
            .Include(x => x.Collections)
            .SingleAsync();

        Assert.Equal(2, result.CollectionsCreated);
        Assert.Equal(1, result.BookmarksCreated);
        Assert.Equal(0, result.BookmarksUpdated);
        Assert.Equal(1, result.BookmarksSkipped);
        Assert.Contains(result.Warnings, warning => warning.Contains("invalid URL", StringComparison.OrdinalIgnoreCase));
        Assert.Equal("https://example.com", importedBookmark.Url);
        Assert.Equal(2, importedBookmark.Collections.Count);
    }

    private static ArcDropDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<ArcDropDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString("N"))
            .Options;

        return new ArcDropDbContext(options);
    }

    private sealed record PortableEnvelope(
        string Version,
        DateTimeOffset ExportedAtUtc,
        IReadOnlyList<PortableCollection> Collections,
        IReadOnlyList<PortableBookmark> Bookmarks);

    private sealed record PortableCollection(string Name, string? Description, string? ParentName);

    private sealed record PortableBookmark(
        string Url,
        string Title,
        string? Summary,
        DateTimeOffset CreatedAtUtc,
        IReadOnlyList<string> CollectionNames);
}