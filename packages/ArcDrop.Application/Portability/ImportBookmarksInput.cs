namespace ArcDrop.Application.Portability;

/// <summary>
/// Carries the raw file content and detected format for a bookmark import operation.
/// Format resolution happens in the transport layer because it depends on request metadata.
/// </summary>
/// <param name="Format">Detected file format used for parsing.</param>
/// <param name="FileContent">Raw UTF-8 text content read from the uploaded file.</param>
public sealed record ImportBookmarksInput(DataPortabilityFormat Format, string FileContent);