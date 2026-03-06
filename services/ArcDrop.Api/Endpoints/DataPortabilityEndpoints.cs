using ArcDrop.Api.Contracts;
using ArcDrop.Application.Portability;
using System.Text;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers import/export endpoints for bookmark data portability workflows.
/// Implements FR-004 and supports AC-004 acceptance criteria.
/// </summary>
internal static class DataPortabilityEndpoints
{
    public static void MapDataPortability(WebApplication app)
    {
        var dataGroup = app.MapGroup("/api/data").WithTags("Data Portability");

        dataGroup.MapPost("/export", async (
            ExportBookmarksRequest request,
            IDataPortabilityService dataPortabilityService,
            CancellationToken cancellationToken) =>
        {
            var exportedFile = await dataPortabilityService.ExportAsync(
                new ExportBookmarksInput(ToApplicationFormat(request.Format), request.CollectionIds),
                cancellationToken);

            return Results.File(
                exportedFile.Content,
                contentType: exportedFile.ContentType,
                fileDownloadName: exportedFile.FileDownloadName);
        })
        .WithName("ExportBookmarks")
        .WithSummary("Exports bookmarks in a portable format.")
        .WithDescription("Builds a portable bookmark export file in JSON, CSV, or HTML format, optionally scoped to selected collections. Implements FR-004 and AC-004 portability requirements.")
        .Accepts<ExportBookmarksRequest>("application/json")
        .Produces(StatusCodes.Status200OK, contentType: "application/octet-stream");

        dataGroup.MapPost("/import", async (
            HttpRequest httpRequest,
            IDataPortabilityService dataPortabilityService,
            CancellationToken cancellationToken) =>
        {
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

            try
            {
                var result = await dataPortabilityService.ImportAsync(
                    new ImportBookmarksInput(ToApplicationFormat(format.Value), fileContent),
                    cancellationToken);

                return Results.Ok(new ImportBookmarksResponse(
                    result.CollectionsCreated,
                    result.BookmarksCreated,
                    result.BookmarksUpdated,
                    result.BookmarksSkipped,
                    result.Warnings));
            }
            catch (InvalidOperationException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["file"] = [exception.Message]
                });
            }
        })
        .WithName("ImportBookmarks")
        .WithSummary("Imports bookmarks from a portable file.")
        .WithDescription("Accepts a multipart file upload in JSON, CSV, or Netscape bookmark HTML format and returns a summary of created, updated, and skipped records.")
        .Accepts<ImportBookmarksMultipartRequest>("multipart/form-data")
        .Produces<ImportBookmarksResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest);
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

    private static DataPortabilityFormat ToApplicationFormat(ExportFormat format)
    {
        return format switch
        {
            ExportFormat.Json => DataPortabilityFormat.Json,
            ExportFormat.Csv => DataPortabilityFormat.Csv,
            ExportFormat.Html => DataPortabilityFormat.Html,
            _ => throw new InvalidOperationException("Unsupported portability format.")
        };
    }
}
