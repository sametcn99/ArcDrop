using ArcDrop.Application.Portability;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Infrastructure.Portability;

/// <summary>
/// Executes bookmark import and export workflows against EF Core persistence.
/// This keeps HTTP endpoint modules limited to request validation and response mapping.
/// </summary>
public sealed class EfCoreDataPortabilityService(
    ArcDropDbContext dbContext,
    ILogger<EfCoreDataPortabilityService> logger) : IDataPortabilityService
{
    /// <inheritdoc />
    public async Task<ExportedBookmarksFile> ExportAsync(ExportBookmarksInput input, CancellationToken cancellationToken)
    {
        // Load collections once so both bookmark filtering and hierarchy resolution use a consistent snapshot.
        var allCollections = await dbContext.Collections
            .AsNoTracking()
            .OrderBy(x => x.Name)
            .ToListAsync(cancellationToken);

        var collectionLookup = allCollections.ToDictionary(x => x.Id);
        IQueryable<Bookmark> bookmarkQuery = dbContext.Bookmarks
            .AsNoTracking()
            .Include(x => x.Collections)
            .OrderByDescending(x => x.UpdatedAtUtc);

        IReadOnlyList<Collection> exportedCollections;

        if (input.CollectionIds is null)
        {
            exportedCollections = allCollections;
        }
        else if (input.CollectionIds.Count == 0)
        {
            bookmarkQuery = bookmarkQuery.Where(x => !x.Collections.Any());
            exportedCollections = [];
        }
        else
        {
            var targetIds = input.CollectionIds.Distinct().ToList();
            bookmarkQuery = bookmarkQuery.Where(x => x.Collections.Any(link => targetIds.Contains(link.CollectionId)));

            // Include ancestor collections so imports can rebuild hierarchy instead of flattening it.
            var expandedCollectionIds = ExpandCollectionHierarchy(targetIds, collectionLookup);
            exportedCollections = allCollections.Where(x => expandedCollectionIds.Contains(x.Id)).ToList();
        }

        var bookmarks = await bookmarkQuery.ToListAsync(cancellationToken);
        var envelope = CreateEnvelope(bookmarks, exportedCollections, collectionLookup);

        return input.Format switch
        {
            DataPortabilityFormat.Json => SerializeJsonExport(envelope),
            DataPortabilityFormat.Csv => SerializeCsvExport(envelope),
            DataPortabilityFormat.Html => SerializeHtmlExport(envelope),
            _ => throw new InvalidOperationException("Unsupported export format.")
        };
    }

    /// <inheritdoc />
    public async Task<ImportBookmarksResult> ImportAsync(ImportBookmarksInput input, CancellationToken cancellationToken)
    {
        BookmarkExportEnvelope envelope;

        try
        {
            envelope = input.Format switch
            {
                DataPortabilityFormat.Json => ParseJsonImport(input.FileContent),
                DataPortabilityFormat.Csv => ParseCsvImport(input.FileContent),
                DataPortabilityFormat.Html => ParseHtmlImport(input.FileContent),
                _ => throw new InvalidOperationException("Unsupported import format.")
            };
        }
        catch (Exception exception) when (exception is not InvalidOperationException)
        {
            logger.LogWarning(exception, "Import file parsing failed for format '{Format}'.", input.Format);
            throw new InvalidOperationException($"Could not parse file as {input.Format}: {exception.Message}", exception);
        }

        var warnings = new List<string>();
        var collectionsCreated = 0;
        var bookmarksCreated = 0;
        var bookmarksUpdated = 0;
        var bookmarksSkipped = 0;

        var existingCollections = await dbContext.Collections.ToListAsync(cancellationToken);
        var collectionNameLookup = existingCollections.ToDictionary(x => x.Name, x => x, StringComparer.OrdinalIgnoreCase);

        foreach (var portable in TopologicalSortCollections(envelope.Collections))
        {
            if (string.IsNullOrWhiteSpace(portable.Name))
            {
                warnings.Add("Skipped collection with empty name.");
                continue;
            }

            if (collectionNameLookup.ContainsKey(portable.Name))
            {
                continue;
            }

            Guid? parentId = null;
            if (!string.IsNullOrWhiteSpace(portable.ParentName))
            {
                if (collectionNameLookup.TryGetValue(portable.ParentName, out var parentCollection))
                {
                    parentId = parentCollection.Id;
                }
                else
                {
                    warnings.Add($"Parent collection '{portable.ParentName}' not found for '{portable.Name}'. Created as root.");
                }
            }

            var utcNow = DateTimeOffset.UtcNow;
            var newCollection = new Collection
            {
                Id = Guid.NewGuid(),
                Name = portable.Name.Trim(),
                Description = string.IsNullOrWhiteSpace(portable.Description) ? null : portable.Description.Trim(),
                ParentId = parentId,
                CreatedAtUtc = utcNow,
                UpdatedAtUtc = utcNow
            };

            dbContext.Collections.Add(newCollection);
            collectionNameLookup[newCollection.Name] = newCollection;
            collectionsCreated++;
        }

        if (collectionsCreated > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var existingBookmarks = await dbContext.Bookmarks
            .Include(x => x.Collections)
            .ToListAsync(cancellationToken);

        var duplicateUrlGroups = existingBookmarks
            .GroupBy(x => x.Url.Trim(), StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .ToList();

        foreach (var duplicateUrlGroup in duplicateUrlGroups)
        {
            warnings.Add($"Multiple bookmarks already exist for URL '{duplicateUrlGroup.Key}'. Import updates only the most recently updated entry.");
        }

        var bookmarkUrlLookup = existingBookmarks
            .GroupBy(x => x.Url.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group
                    .OrderByDescending(x => x.UpdatedAtUtc)
                    .ThenByDescending(x => x.CreatedAtUtc)
                    .First(),
                StringComparer.OrdinalIgnoreCase);

        foreach (var portable in envelope.Bookmarks)
        {
            if (string.IsNullOrWhiteSpace(portable.Url) || !Uri.TryCreate(portable.Url, UriKind.Absolute, out _))
            {
                warnings.Add($"Skipped bookmark with invalid URL: '{portable.Url}'.");
                bookmarksSkipped++;
                continue;
            }

            var normalizedPortableUrl = portable.Url.Trim();

            if (string.IsNullOrWhiteSpace(portable.Title))
            {
                warnings.Add($"Skipped bookmark '{portable.Url}' with empty title.");
                bookmarksSkipped++;
                continue;
            }

            var targetCollectionIds = new List<Guid>();
            foreach (var collectionName in portable.CollectionNames ?? [])
            {
                if (collectionNameLookup.TryGetValue(collectionName, out var collection))
                {
                    targetCollectionIds.Add(collection.Id);
                }
                else
                {
                    warnings.Add($"Collection '{collectionName}' referenced by bookmark '{portable.Url}' was not found.");
                }
            }

            if (bookmarkUrlLookup.TryGetValue(normalizedPortableUrl, out var existingBookmark))
            {
                var changed = false;
                if (!string.IsNullOrWhiteSpace(portable.Title) && !string.Equals(existingBookmark.Title, portable.Title, StringComparison.Ordinal))
                {
                    existingBookmark.Title = portable.Title.Trim();
                    changed = true;
                }

                if (!string.IsNullOrWhiteSpace(portable.Summary) && string.IsNullOrWhiteSpace(existingBookmark.Summary))
                {
                    existingBookmark.Summary = portable.Summary.Trim();
                    changed = true;
                }

                var existingLinkIds = existingBookmark.Collections.Select(link => link.CollectionId).ToHashSet();
                foreach (var collectionId in targetCollectionIds.Where(id => !existingLinkIds.Contains(id)))
                {
                    existingBookmark.Collections.Add(new BookmarkCollectionLink
                    {
                        BookmarkId = existingBookmark.Id,
                        CollectionId = collectionId
                    });
                    changed = true;
                }

                if (changed)
                {
                    existingBookmark.UpdatedAtUtc = DateTimeOffset.UtcNow;
                    bookmarksUpdated++;
                }
                else
                {
                    bookmarksSkipped++;
                }
            }
            else
            {
                var utcNow = DateTimeOffset.UtcNow;
                var newBookmark = new Bookmark
                {
                    Id = Guid.NewGuid(),
                    Url = normalizedPortableUrl,
                    Title = portable.Title.Trim(),
                    Summary = string.IsNullOrWhiteSpace(portable.Summary) ? null : portable.Summary.Trim(),
                    CreatedAtUtc = portable.CreatedAtUtc != default ? portable.CreatedAtUtc : utcNow,
                    UpdatedAtUtc = utcNow
                };

                dbContext.Bookmarks.Add(newBookmark);

                foreach (var collectionId in targetCollectionIds.Distinct())
                {
                    newBookmark.Collections.Add(new BookmarkCollectionLink
                    {
                        BookmarkId = newBookmark.Id,
                        CollectionId = collectionId
                    });
                }

                bookmarkUrlLookup[newBookmark.Url] = newBookmark;
                bookmarksCreated++;
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Import completed: {CollectionsCreated} collections created, {BookmarksCreated} bookmarks created, " +
            "{BookmarksUpdated} updated, {BookmarksSkipped} skipped, {Warnings} warnings.",
            collectionsCreated,
            bookmarksCreated,
            bookmarksUpdated,
            bookmarksSkipped,
            warnings.Count);

        return new ImportBookmarksResult(
            collectionsCreated,
            bookmarksCreated,
            bookmarksUpdated,
            bookmarksSkipped,
            warnings);
    }

    private static BookmarkExportEnvelope CreateEnvelope(
        IReadOnlyList<Bookmark> bookmarks,
        IReadOnlyList<Collection> exportedCollections,
        IReadOnlyDictionary<Guid, Collection> collectionLookup)
    {
        var portableCollections = exportedCollections
            .Select(x => new PortableCollectionEntry(
                x.Name,
                x.Description,
                x.ParentId.HasValue && collectionLookup.TryGetValue(x.ParentId.Value, out var parent) ? parent.Name : null))
            .ToList();

        var portableBookmarks = bookmarks
            .Select(x => new PortableBookmarkEntry(
                x.Url,
                x.Title,
                x.Summary,
                x.CreatedAtUtc,
                x.Collections
                    .Where(link => collectionLookup.ContainsKey(link.CollectionId))
                    .Select(link => collectionLookup[link.CollectionId].Name)
                    .OrderBy(name => name)
                    .ToList()))
            .ToList();

        return new BookmarkExportEnvelope(
            Version: "1.0",
            ExportedAtUtc: DateTimeOffset.UtcNow,
            Collections: portableCollections,
            Bookmarks: portableBookmarks);
    }

    private static HashSet<Guid> ExpandCollectionHierarchy(IReadOnlyList<Guid> targetIds, IReadOnlyDictionary<Guid, Collection> lookup)
    {
        var expanded = new HashSet<Guid>(targetIds);
        var queue = new Queue<Guid>(targetIds);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!lookup.TryGetValue(current, out var collection) || !collection.ParentId.HasValue)
            {
                continue;
            }

            if (expanded.Add(collection.ParentId.Value))
            {
                queue.Enqueue(collection.ParentId.Value);
            }
        }

        return expanded;
    }

    private static ExportedBookmarksFile SerializeJsonExport(BookmarkExportEnvelope envelope)
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true
        };

        return new ExportedBookmarksFile(
            JsonSerializer.SerializeToUtf8Bytes(envelope, options),
            "application/json",
            $"arcdrop-bookmarks-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json");
    }

    private static ExportedBookmarksFile SerializeCsvExport(BookmarkExportEnvelope envelope)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Url,Title,Summary,CreatedAtUtc,Collections");

        foreach (var bookmark in envelope.Bookmarks)
        {
            var collections = string.Join("|", bookmark.CollectionNames);
            sb.Append(CsvEscapeField(bookmark.Url));
            sb.Append(',');
            sb.Append(CsvEscapeField(bookmark.Title));
            sb.Append(',');
            sb.Append(CsvEscapeField(bookmark.Summary ?? string.Empty));
            sb.Append(',');
            sb.Append(CsvEscapeField(bookmark.CreatedAtUtc.ToString("o")));
            sb.Append(',');
            sb.AppendLine(CsvEscapeField(collections));
        }

        return new ExportedBookmarksFile(
            Encoding.UTF8.GetBytes(sb.ToString()),
            "text/csv; charset=utf-8",
            $"arcdrop-bookmarks-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    private static string CsvEscapeField(string value)
    {
        if (value.Contains('"') || value.Contains(',') || value.Contains('\n') || value.Contains('\r'))
        {
            return $"\"{value.Replace("\"", "\"\"")}\"";
        }

        return value;
    }

    private static ExportedBookmarksFile SerializeHtmlExport(BookmarkExportEnvelope envelope)
    {
        var sb = new StringBuilder();
        sb.AppendLine("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
        sb.AppendLine("<!-- This is an automatically generated file. -->");
        sb.AppendLine("<!--     It will be read and overwritten. -->");
        sb.AppendLine("<!--     DO NOT EDIT! -->");
        sb.AppendLine("<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">");
        sb.AppendLine("<TITLE>ArcDrop Bookmarks</TITLE>");
        sb.AppendLine("<H1>ArcDrop Bookmarks</H1>");
        sb.AppendLine("<DL><p>");

        var bookmarksByCollection = new Dictionary<string, List<PortableBookmarkEntry>>(StringComparer.OrdinalIgnoreCase);
        var unassignedBookmarks = new List<PortableBookmarkEntry>();

        foreach (var bookmark in envelope.Bookmarks)
        {
            if (bookmark.CollectionNames.Count == 0)
            {
                unassignedBookmarks.Add(bookmark);
                continue;
            }

            foreach (var collectionName in bookmark.CollectionNames)
            {
                if (!bookmarksByCollection.TryGetValue(collectionName, out var list))
                {
                    list = [];
                    bookmarksByCollection[collectionName] = list;
                }

                list.Add(bookmark);
            }
        }

        var collectionChildren = new Dictionary<string, List<PortableCollectionEntry>>(StringComparer.OrdinalIgnoreCase);
        var rootCollections = new List<PortableCollectionEntry>();

        foreach (var collection in envelope.Collections)
        {
            if (string.IsNullOrWhiteSpace(collection.ParentName))
            {
                rootCollections.Add(collection);
                continue;
            }

            if (!collectionChildren.TryGetValue(collection.ParentName, out var children))
            {
                children = [];
                collectionChildren[collection.ParentName] = children;
            }

            children.Add(collection);
        }

        void WriteCollectionFolder(PortableCollectionEntry collection, int indent)
        {
            var prefix = new string(' ', indent * 4);
            sb.AppendLine($"{prefix}<DT><H3>{HtmlEncode(collection.Name)}</H3>");

            if (!string.IsNullOrWhiteSpace(collection.Description))
            {
                sb.AppendLine($"{prefix}<DD>{HtmlEncode(collection.Description)}");
            }

            sb.AppendLine($"{prefix}<DL><p>");

            if (bookmarksByCollection.TryGetValue(collection.Name, out var collectionBookmarks))
            {
                foreach (var bookmark in collectionBookmarks)
                {
                    WriteBookmarkEntry(bookmark, indent + 1, sb);
                }
            }

            if (collectionChildren.TryGetValue(collection.Name, out var children))
            {
                foreach (var child in children)
                {
                    WriteCollectionFolder(child, indent + 1);
                }
            }

            sb.AppendLine($"{prefix}</DL><p>");
        }

        foreach (var rootCollection in rootCollections)
        {
            WriteCollectionFolder(rootCollection, 1);
        }

        foreach (var bookmark in unassignedBookmarks)
        {
            WriteBookmarkEntry(bookmark, 1, sb);
        }

        sb.AppendLine("</DL><p>");

        return new ExportedBookmarksFile(
            Encoding.UTF8.GetBytes(sb.ToString()),
            "text/html; charset=utf-8",
            $"arcdrop-bookmarks-{DateTime.UtcNow:yyyyMMdd-HHmmss}.html");
    }

    private static void WriteBookmarkEntry(PortableBookmarkEntry bookmark, int indent, StringBuilder sb)
    {
        var prefix = new string(' ', indent * 4);
        var addDate = bookmark.CreatedAtUtc.ToUnixTimeSeconds();
        sb.AppendLine($"{prefix}<DT><A HREF=\"{HtmlEncode(bookmark.Url)}\" ADD_DATE=\"{addDate}\">{HtmlEncode(bookmark.Title)}</A>");

        if (!string.IsNullOrWhiteSpace(bookmark.Summary))
        {
            sb.AppendLine($"{prefix}<DD>{HtmlEncode(bookmark.Summary)}");
        }
    }

    private static string HtmlEncode(string value)
    {
        return value
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;");
    }

    private static BookmarkExportEnvelope ParseJsonImport(string content)
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };

        var envelope = JsonSerializer.Deserialize<BookmarkExportEnvelope>(content, options);
        if (envelope is null)
        {
            throw new InvalidOperationException("JSON content could not be deserialized into a bookmark export envelope.");
        }

        return envelope;
    }

    private static BookmarkExportEnvelope ParseCsvImport(string content)
    {
        var lines = content.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length < 2)
        {
            throw new InvalidOperationException("CSV file must contain a header row and at least one data row.");
        }

        var bookmarks = new List<PortableBookmarkEntry>();
        var collectionNamesSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 1; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var fields = ParseCsvLine(line);
            if (fields.Count < 2)
            {
                continue;
            }

            var url = fields.Count > 0 ? fields[0] : string.Empty;
            var title = fields.Count > 1 ? fields[1] : string.Empty;
            var summary = fields.Count > 2 ? fields[2] : null;
            var createdAtRaw = fields.Count > 3 ? fields[3] : null;
            var collectionsRaw = fields.Count > 4 ? fields[4] : string.Empty;

            var createdAt = DateTimeOffset.TryParse(createdAtRaw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
                ? parsed
                : DateTimeOffset.UtcNow;

            var collectionNames = string.IsNullOrWhiteSpace(collectionsRaw)
                ? []
                : collectionsRaw.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();

            foreach (var name in collectionNames)
            {
                collectionNamesSet.Add(name);
            }

            bookmarks.Add(new PortableBookmarkEntry(url, title, summary, createdAt, collectionNames));
        }

        var collections = collectionNamesSet
            .Select(name => new PortableCollectionEntry(name, null, null))
            .ToList();

        return new BookmarkExportEnvelope("1.0", DateTimeOffset.UtcNow, collections, bookmarks);
    }

    private static List<string> ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var currentCharacter = line[i];

            if (inQuotes)
            {
                if (currentCharacter == '"')
                {
                    if (i + 1 < line.Length && line[i + 1] == '"')
                    {
                        current.Append('"');
                        i++;
                    }
                    else
                    {
                        inQuotes = false;
                    }
                }
                else
                {
                    current.Append(currentCharacter);
                }
            }
            else
            {
                if (currentCharacter == '"')
                {
                    inQuotes = true;
                }
                else if (currentCharacter == ',')
                {
                    fields.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(currentCharacter);
                }
            }
        }

        fields.Add(current.ToString());
        return fields;
    }

    private static BookmarkExportEnvelope ParseHtmlImport(string content)
    {
        var bookmarks = new List<PortableBookmarkEntry>();
        var collections = new List<PortableCollectionEntry>();
        var folderStack = new Stack<string>();

        foreach (var rawLine in content.Split('\n'))
        {
            var line = rawLine.Trim();

            var h3Match = Regex.Match(line, @"<H3[^>]*>(.*?)</H3>", RegexOptions.IgnoreCase);
            if (h3Match.Success)
            {
                var folderName = HtmlDecode(h3Match.Groups[1].Value).Trim();
                if (!string.IsNullOrWhiteSpace(folderName))
                {
                    var parentName = folderStack.Count > 0 ? folderStack.Peek() : null;
                    collections.Add(new PortableCollectionEntry(folderName, null, parentName));
                    folderStack.Push(folderName);
                }

                continue;
            }

            if (line.StartsWith("</DL>", StringComparison.OrdinalIgnoreCase) && folderStack.Count > 0)
            {
                folderStack.Pop();
                continue;
            }

            var linkMatch = Regex.Match(line, @"<A\s+HREF=""([^""]+)""(?:\s+ADD_DATE=""(\d+)"")?[^>]*>(.*?)</A>", RegexOptions.IgnoreCase);
            if (linkMatch.Success)
            {
                var url = HtmlDecode(linkMatch.Groups[1].Value).Trim();
                var addDateRaw = linkMatch.Groups[2].Value;
                var title = HtmlDecode(linkMatch.Groups[3].Value).Trim();

                var createdAt = long.TryParse(addDateRaw, out var unixSeconds) && unixSeconds > 0
                    ? DateTimeOffset.FromUnixTimeSeconds(unixSeconds)
                    : DateTimeOffset.UtcNow;

                var currentCollections = folderStack.Count > 0
                    ? new List<string> { folderStack.Peek() }
                    : [];

                bookmarks.Add(new PortableBookmarkEntry(url, title, null, createdAt, currentCollections));
            }

            if (line.StartsWith("<DD>", StringComparison.OrdinalIgnoreCase) && bookmarks.Count > 0)
            {
                var description = HtmlDecode(line[4..]).Trim();
                if (!string.IsNullOrWhiteSpace(description))
                {
                    var lastBookmark = bookmarks[^1];
                    bookmarks[^1] = lastBookmark with { Summary = description };
                }
            }
        }

        return new BookmarkExportEnvelope("1.0", DateTimeOffset.UtcNow, collections, bookmarks);
    }

    private static string HtmlDecode(string value)
    {
        return value
            .Replace("&lt;", "<")
            .Replace("&gt;", ">")
            .Replace("&quot;", "\"")
            .Replace("&#39;", "'")
            .Replace("&amp;", "&");
    }

    private static IReadOnlyList<PortableCollectionEntry> TopologicalSortCollections(IReadOnlyList<PortableCollectionEntry> collections)
    {
        var result = new List<PortableCollectionEntry>();
        var remaining = new List<PortableCollectionEntry>(collections);
        var resolved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var maxIterations = collections.Count + 1;

        for (var iteration = 0; iteration < maxIterations && remaining.Count > 0; iteration++)
        {
            var promoted = new List<PortableCollectionEntry>();
            var stillRemaining = new List<PortableCollectionEntry>();

            foreach (var collection in remaining)
            {
                if (string.IsNullOrWhiteSpace(collection.ParentName) || resolved.Contains(collection.ParentName))
                {
                    promoted.Add(collection);
                    resolved.Add(collection.Name);
                }
                else
                {
                    stillRemaining.Add(collection);
                }
            }

            result.AddRange(promoted);
            remaining = stillRemaining;

            if (promoted.Count == 0)
            {
                result.AddRange(remaining);
                break;
            }
        }

        return result;
    }

    private sealed record PortableBookmarkEntry(
        string Url,
        string Title,
        string? Summary,
        DateTimeOffset CreatedAtUtc,
        IReadOnlyList<string> CollectionNames);

    private sealed record PortableCollectionEntry(
        string Name,
        string? Description,
        string? ParentName);

    private sealed record BookmarkExportEnvelope(
        string Version,
        DateTimeOffset ExportedAtUtc,
        IReadOnlyList<PortableCollectionEntry> Collections,
        IReadOnlyList<PortableBookmarkEntry> Bookmarks);
}