using System.Globalization;
using System.Text.RegularExpressions;

namespace ArcDrop.Application.Ai;

/// <summary>
/// Implements deterministic fallback suggestion generation for ArcDrop bookmark organization operations.
/// The implementation intentionally avoids external provider calls so behavior remains stable in tests.
/// </summary>
public sealed class DeterministicOrganizationSuggestionService : IOrganizationSuggestionService
{
    /// <inheritdoc />
    public string? NormalizeOperationType(string rawOperationType)
    {
        var normalized = rawOperationType.Trim().ToLowerInvariant();

        return normalized switch
        {
            "tag-suggestions" => normalized,
            "collection-suggestions" => normalized,
            "title-cleanup" => normalized,
            "summary-cleanup" => normalized,
            _ => null
        };
    }

    /// <inheritdoc />
    public IReadOnlyList<OrganizationSuggestionItem> GenerateResults(
        string normalizedOperationType,
        string title,
        string? summary,
        string url)
    {
        return normalizedOperationType switch
        {
            "tag-suggestions" => GenerateTagSuggestions(title, summary, url),
            "collection-suggestions" => GenerateCollectionSuggestions(title, summary, url),
            "title-cleanup" => GenerateTitleCleanup(title),
            "summary-cleanup" => GenerateSummaryCleanup(title, summary),
            _ => []
        };
    }

    private static IReadOnlyList<OrganizationSuggestionItem> GenerateTagSuggestions(string title, string? summary, string url)
    {
        var textSeed = $"{title} {summary} {url}";
        var tokens = Regex.Split(textSeed.ToLowerInvariant(), "[^a-z0-9]+")
            .Where(x => x.Length >= 4)
            .Where(x => !IsTagStopWord(x))
            .Distinct()
            .Take(5)
            .ToList();

        if (tokens.Count == 0)
        {
            tokens.Add("reference");
        }

        return tokens
            .Select((x, index) => new OrganizationSuggestionItem("tag", x, 0.95m - (index * 0.1m)))
            .ToList();
    }

    private static IReadOnlyList<OrganizationSuggestionItem> GenerateCollectionSuggestions(string title, string? summary, string url)
    {
        var source = $"{title} {summary} {url}".ToLowerInvariant();
        var collections = new List<OrganizationSuggestionItem>();

        if (source.Contains("dotnet") || source.Contains("csharp") || source.Contains("api") || source.Contains("dev"))
        {
            collections.Add(new OrganizationSuggestionItem("collection", "Engineering", 0.92m));
        }

        if (source.Contains("design") || source.Contains("ux") || source.Contains("ui"))
        {
            collections.Add(new OrganizationSuggestionItem("collection", "Design", 0.88m));
        }

        if (source.Contains("ai") || source.Contains("ml") || source.Contains("model"))
        {
            collections.Add(new OrganizationSuggestionItem("collection", "AI Research", 0.9m));
        }

        if (collections.Count == 0)
        {
            collections.Add(new OrganizationSuggestionItem("collection", "General", 0.7m));
        }

        return collections;
    }

    private static IReadOnlyList<OrganizationSuggestionItem> GenerateTitleCleanup(string title)
    {
        var collapsed = Regex.Replace(title.Trim(), "\\s+", " ");
        var textInfo = CultureInfo.InvariantCulture.TextInfo;
        var cleaned = textInfo.ToTitleCase(collapsed.ToLowerInvariant());

        return [new OrganizationSuggestionItem("title", cleaned, 0.9m)];
    }

    private static IReadOnlyList<OrganizationSuggestionItem> GenerateSummaryCleanup(string title, string? summary)
    {
        var normalizedTitle = Regex.Replace(title.Trim(), "\\s+", " ");
        var normalizedSummary = string.IsNullOrWhiteSpace(summary)
            ? $"Reference material about {normalizedTitle}."
            : Regex.Replace(summary.Trim(), "\\s+", " ");

        if (!normalizedSummary.EndsWith(".", StringComparison.Ordinal))
        {
            normalizedSummary += ".";
        }

        return [new OrganizationSuggestionItem("summary", normalizedSummary, 0.85m)];
    }

    private static bool IsTagStopWord(string token)
    {
        return token is
            "https" or
            "http" or
            "www" or
            "with" or
            "from" or
            "this" or
            "that" or
            "have" or
            "your" or
            "into" or
            "about" or
            "bookmark" or
            "title" or
            "summary";
    }
}
