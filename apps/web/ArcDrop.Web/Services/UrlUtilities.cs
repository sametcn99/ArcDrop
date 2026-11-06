namespace ArcDrop.Web.Services;

/// <summary>
/// Shared URL and collection-tree helpers used across bookmark views.
/// Centralizing these removes copy-pasted domain logic from page components.
/// </summary>
public static class UrlUtilities
{
    /// <summary>
    /// Returns the host portion of a URL or a fallback label for invalid input.
    /// </summary>
    public static string DomainFromUrl(string url)
    {
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return uri.Host;
        }

        return "unknown-source";
    }

    /// <summary>
    /// Returns an uppercase first character of the URL domain for icon fallbacks.
    /// </summary>
    public static string DomainInitial(string url)
    {
        var domain = DomainFromUrl(url);
        var initial = domain.FirstOrDefault(static character => char.IsLetterOrDigit(character));
        return initial == default ? "?" : char.ToUpperInvariant(initial).ToString();
    }

    /// <summary>
    /// Builds the bookmark icon endpoint URL normalized to the site origin for browser caching.
    /// </summary>
    public static string BuildBookmarkIconUrl(string url)
    {
        var cacheKeyUrl = url;
        if (Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            cacheKeyUrl = uri.GetLeftPart(UriPartial.Authority);
        }

        return $"/bookmark-icons?url={Uri.EscapeDataString(cacheKeyUrl)}";
    }

    /// <summary>
    /// Computes the depth of a collection within the parent hierarchy.
    /// </summary>
    public static int CollectionDepth(IReadOnlyList<CollectionDto> collections, Guid collectionId)
    {
        var lookup = collections.ToDictionary(x => x.Id, x => x.ParentId);
        var depth = 0;
        var current = lookup.TryGetValue(collectionId, out var parentId) ? parentId : null;

        while (current is not null && lookup.TryGetValue(current.Value, out var nextParentId))
        {
            depth++;
            current = nextParentId;
        }

        return depth;
    }
}
