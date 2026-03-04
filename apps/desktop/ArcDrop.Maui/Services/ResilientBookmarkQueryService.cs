using ArcDrop.Application.Bookmarks;
using Microsoft.Extensions.Logging;

namespace ArcDrop.Maui.Services;

/// <summary>
/// Provides resilient bookmark queries by preferring API data and falling back to seed data.
/// This keeps early desktop UX usable when backend connectivity is temporarily unavailable.
/// </summary>
public sealed class ResilientBookmarkQueryService : IBookmarkQueryService
{
    private readonly ApiBookmarkQueryService _apiService;
    private readonly SeedBookmarkQueryService _seedService;
    private readonly ILogger<ResilientBookmarkQueryService> _logger;

    public ResilientBookmarkQueryService(
        ApiBookmarkQueryService apiService,
        SeedBookmarkQueryService seedService,
        ILogger<ResilientBookmarkQueryService> logger)
    {
        _apiService = apiService;
        _seedService = seedService;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<BookmarkListItem>> GetBookmarksAsync(string? searchTerm, CancellationToken cancellationToken)
    {
        try
        {
            return await _apiService.GetBookmarksAsync(searchTerm, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(
                exception,
                "Bookmark API query failed. Falling back to deterministic seed data for search '{SearchTerm}'.",
                searchTerm ?? string.Empty);

            return await _seedService.GetBookmarksAsync(searchTerm, cancellationToken);
        }
    }

    /// <inheritdoc />
    public async Task<BookmarkDetailItem?> GetBookmarkByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        try
        {
            return await _apiService.GetBookmarkByIdAsync(id, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
        {
            _logger.LogWarning(
                exception,
                "Bookmark detail API query failed. Falling back to seed data for bookmark '{BookmarkId}'.",
                id);

            return await _seedService.GetBookmarkByIdAsync(id, cancellationToken);
        }
    }
}
