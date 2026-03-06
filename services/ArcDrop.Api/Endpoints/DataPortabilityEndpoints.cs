using ArcDrop.Api.Contracts;
using ArcDrop.Domain.Entities;
using ArcDrop.Infrastructure.Persistence;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers import/export endpoints for bookmark data portability workflows.
/// Implements FR-004 and supports AC-004 acceptance criteria.
/// </summary>
internal static class DataPortabilityEndpoints
{
    public static void MapDataPortability(WebApplication app)
    {
        var dataGroup = app.MapGroup("/api/data");

        dataGroup.MapPost("/export", async (
            ExportBookmarksRequest request,
            ArcDropDbContext dbContext,
            CancellationToken cancellationToken) =>
        {
            // Load all collections with parent references to resolve hierarchical name paths during export.
            var allCollections = await dbContext.Collections
                .AsNoTracking()
                .OrderBy(x => x.Name)
                .ToListAsync(cancellationToken);

            var collectionLookup = allCollections.ToDictionary(x => x.Id);

            // Build the collection scope filter: null = all, empty = unassigned only, populated = specific collections.
            IQueryable<Bookmark> bookmarkQuery = dbContext.Bookmarks
                .AsNoTracking()
                .Include(x => x.Collections)
                .OrderByDescending(x => x.UpdatedAtUtc);

            IReadOnlyList<Collection> exportedCollections;

            if (request.CollectionIds is null)
            {
                exportedCollections = allCollections;
            }
            else if (request.CollectionIds.Count == 0)
            {
                bookmarkQuery = bookmarkQuery.Where(x => !x.Collections.Any());
                exportedCollections = [];
            }
            else
            {
                var targetIds = request.CollectionIds.Distinct().ToList();
                bookmarkQuery = bookmarkQuery.Where(x => x.Collections.Any(link => targetIds.Contains(link.CollectionId)));

                // Include parent collections in the export so hierarchy can be reconstructed on import.
                var expandedCollectionIds = ExpandCollectionHierarchy(targetIds, collectionLookup);
                exportedCollections = allCollections.Where(x => expandedCollectionIds.Contains(x.Id)).ToList();
            }

            var bookmarks = await bookmarkQuery.ToListAsync(cancellationToken);

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

            var envelope = new BookmarkExportEnvelope(
                Version: "1.0",
                ExportedAtUtc: DateTimeOffset.UtcNow,
                Collections: portableCollections,
                Bookmarks: portableBookmarks);

            return request.Format switch
            {
                ExportFormat.Json => SerializeJsonExport(envelope),
                ExportFormat.Csv => SerializeCsvExport(envelope),
                ExportFormat.Html => SerializeHtmlExport(envelope),
                _ => Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Format)] = ["Unsupported export format."]
                })
            };
        });

        dataGroup.MapPost("/import", async (
            HttpRequest httpRequest,
            ArcDropDbContext dbContext,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken) =>
        {
            var logger = loggerFactory.CreateLogger("ArcDrop.Api.DataPortability");

            if (!httpRequest.HasFormContentType)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = ["Request must be multipart/form-data with a file upload."]
                });
            }

            var form = await httpRequest.ReadFormAsync(cancellationToken);
            var file = form.Files.GetFile("file");
            if (file is null || file.Length == 0)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = ["A non-empty file is required."]
                });
            }

            // Reject files with unexpected content types to prevent processing non-text payloads.
            var allowedContentTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "application/json", "text/json", "text/csv", "text/html",
                "application/octet-stream", "application/x-netscape-bookmark-file-1"
            };

            if (!string.IsNullOrWhiteSpace(file.ContentType) && !allowedContentTypes.Contains(file.ContentType))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = [$"Unsupported content type '{file.ContentType}'. Accepted types: JSON, CSV, or HTML files."]
                });
            }

            var formatRaw = form["format"].FirstOrDefault() ?? httpRequest.Query["format"].FirstOrDefault();
            var format = ResolveImportFormat(formatRaw, file.FileName);

            if (format is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["format"] = ["Could not determine import format. Provide a 'format' field (json, csv, or html) or use a recognized file extension."]
                });
            }

            string fileContent;
            using (var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8))
            {
                fileContent = await reader.ReadToEndAsync(cancellationToken);
            }

            if (string.IsNullOrWhiteSpace(fileContent))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = ["File content is empty."]
                });
            }

            BookmarkExportEnvelope? envelope;
            try
            {
                envelope = format.Value switch
                {
                    ExportFormat.Json => ParseJsonImport(fileContent),
                    ExportFormat.Csv => ParseCsvImport(fileContent),
                    ExportFormat.Html => ParseHtmlImport(fileContent),
                    _ => null
                };
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Import file parsing failed for format '{Format}'.", format.Value);
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = [$"Could not parse file as {format.Value}: {ex.Message}"]
                });
            }

            if (envelope is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = ["File could not be parsed into a valid bookmark structure."]
                });
            }

            var warnings = new List<string>();
            var collectionsCreated = 0;
            var bookmarksCreated = 0;
            var bookmarksUpdated = 0;
            var bookmarksSkipped = 0;

            var existingCollections = await dbContext.Collections.ToListAsync(cancellationToken);
            var collectionNameLookup = existingCollections.ToDictionary(x => x.Name, x => x, StringComparer.OrdinalIgnoreCase);

            // Sort collections so parent collections are created before their children.
            var sortedCollections = TopologicalSortCollections(envelope.Collections);
            foreach (var portable in sortedCollections)
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

            // Historical data may contain duplicate URLs. Keep one canonical row per URL so import can continue safely.
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

            return Results.Ok(new ImportBookmarksResponse(
                collectionsCreated,
                bookmarksCreated,
                bookmarksUpdated,
                bookmarksSkipped,
                warnings));
        });
    }

    private static HashSet<Guid> ExpandCollectionHierarchy(IReadOnlyList<Guid> targetIds, Dictionary<Guid, Collection> lookup)
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

    private static IResult SerializeJsonExport(BookmarkExportEnvelope envelope)
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true
        };

        var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(envelope, options);
        return Results.File(
            jsonBytes,
            contentType: "application/json",
            fileDownloadName: $"arcdrop-bookmarks-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json");
    }

    private static IResult SerializeCsvExport(BookmarkExportEnvelope envelope)
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

        var csvBytes = Encoding.UTF8.GetBytes(sb.ToString());
        return Results.File(
            csvBytes,
            contentType: "text/csv; charset=utf-8",
            fileDownloadName: $"arcdrop-bookmarks-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    private static string CsvEscapeField(string value)
    {
        if (value.Contains('"') || value.Contains(',') || value.Contains('\n') || value.Contains('\r'))
        {
            return $"\"{value.Replace("\"", "\"\"")}\"";
        }

        return value;
    }

    private static IResult SerializeHtmlExport(BookmarkExportEnvelope envelope)
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
            }
            else
            {
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
        }

        var collectionChildren = new Dictionary<string, List<PortableCollectionEntry>>(StringComparer.OrdinalIgnoreCase);
        var rootCollections = new List<PortableCollectionEntry>();

        foreach (var collection in envelope.Collections)
        {
            if (string.IsNullOrWhiteSpace(collection.ParentName))
            {
                rootCollections.Add(collection);
            }
            else
            {
                if (!collectionChildren.TryGetValue(collection.ParentName, out var children))
                {
                    children = [];
                    collectionChildren[collection.ParentName] = children;
                }

                children.Add(collection);
            }
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

        var htmlBytes = Encoding.UTF8.GetBytes(sb.ToString());
        return Results.File(
            htmlBytes,
            contentType: "text/html; charset=utf-8",
            fileDownloadName: $"arcdrop-bookmarks-{DateTime.UtcNow:yyyyMMdd-HHmmss}.html");
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
            var c = line[i];

            if (inQuotes)
            {
                if (c == '"')
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
                    current.Append(c);
                }
            }
            else
            {
                if (c == '"')
                {
                    inQuotes = true;
                }
                else if (c == ',')
                {
                    fields.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(c);
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

        var lines = content.Split('\n');

        foreach (var rawLine in lines)
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
                    : new List<string>();

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

    private static ExportFormat? ResolveImportFormat(string? formatHint, string? fileName)
    {
        if (!string.IsNullOrWhiteSpace(formatHint))
        {
            return formatHint.Trim().ToLowerInvariant() switch
            {
                "json" => ExportFormat.Json,
                "csv" => ExportFormat.Csv,
                "html" => ExportFormat.Html,
                "htm" => ExportFormat.Html,
                _ => null
            };
        }

        if (!string.IsNullOrWhiteSpace(fileName))
        {
            var extension = Path.GetExtension(fileName).ToLowerInvariant();
            return extension switch
            {
                ".json" => ExportFormat.Json,
                ".csv" => ExportFormat.Csv,
                ".html" => ExportFormat.Html,
                ".htm" => ExportFormat.Html,
                _ => null
            };
        }

        return null;
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
}
