namespace ArcDrop.Web.Services;

/// <summary>
/// Centralizes route-auth policy decisions so login redirects and return URLs are consistent.
/// </summary>
public static class AuthRoutePolicy
{
    /// <summary>
    /// Returns true when the route can be accessed without authentication.
    /// </summary>
    public static bool IsPublicPath(string rawPath)
    {
        var normalized = NormalizePath(rawPath);
        return normalized is "auth/login" or "not-found" or "error";
    }

    /// <summary>
    /// Normalizes a route path for case-insensitive comparison.
    /// </summary>
    public static string NormalizePath(string? rawPath)
    {
        var normalized = (rawPath ?? string.Empty).Trim();

        // Route matching must ignore query string and fragment so login URLs are recognized consistently.
        var separatorIndex = normalized.IndexOfAny(['?', '#']);
        if (separatorIndex >= 0)
        {
            normalized = normalized[..separatorIndex];
        }

        return normalized
            .TrimStart('/')
            .ToLowerInvariant();
    }

    /// <summary>
    /// Returns a safe local return URL for post-login navigation; invalid values fall back to bookmarks.
    /// </summary>
    public static string ResolveSafeReturnUrl(string? returnUrl)
    {
        if (string.IsNullOrWhiteSpace(returnUrl))
        {
            return "/bookmarks";
        }

        var candidate = returnUrl.Trim();
        if (!candidate.StartsWith("/", StringComparison.Ordinal) || candidate.StartsWith("//", StringComparison.Ordinal))
        {
            return "/bookmarks";
        }

        var normalized = NormalizePath(candidate);
        if (normalized.Length == 0 || normalized == "auth/login")
        {
            return "/bookmarks";
        }

        return candidate;
    }
}
