namespace ArcDrop.Application.Portability;

/// <summary>
/// Represents a completed export file ready to be returned by a transport layer.
/// The application workflow decides content bytes and metadata so endpoints stay thin.
/// </summary>
/// <param name="Content">Serialized file content.</param>
/// <param name="ContentType">HTTP-compatible content type for the payload.</param>
/// <param name="FileDownloadName">Suggested filename for client download flows.</param>
public sealed record ExportedBookmarksFile(byte[] Content, string ContentType, string FileDownloadName);