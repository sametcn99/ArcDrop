namespace ArcDrop.Application.Portability;

/// <summary>
/// Defines the supported data portability formats independent from HTTP-layer contracts.
/// This keeps application workflows reusable by non-API callers.
/// </summary>
public enum DataPortabilityFormat
{
    Json,
    Csv,
    Html
}