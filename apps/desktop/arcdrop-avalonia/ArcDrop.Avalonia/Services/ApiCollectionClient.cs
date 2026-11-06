using System.Net.Http.Json;

namespace ArcDrop.Avalonia.Services;

/// <summary>
/// Represents one collection row for pickers and membership editors.
/// </summary>
public sealed record CollectionDto(
    Guid Id,
    string Name,
    string? Description,
    Guid? ParentId);

/// <summary>
/// Typed ArcDrop API client for collection pickers on the Linux desktop client.
/// </summary>
public sealed class ApiCollectionClient(HttpClient httpClient)
{
    private sealed record CollectionResponse(Guid Id, string Name, string? Description, Guid? ParentId);

    /// <summary>
    /// Returns the flat collection list ordered for pickers.
    /// </summary>
    public async Task<IReadOnlyList<CollectionDto>> GetCollectionsAsync(CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync("api/collections", cancellationToken);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<List<CollectionResponse>>(cancellationToken: cancellationToken)
            ?? [];

        return payload
            .Select(item => new CollectionDto(item.Id, item.Name, item.Description, item.ParentId))
            .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// Computes the depth of a collection within the parent hierarchy for indentation.
    /// </summary>
    public static int CollectionDepth(IReadOnlyList<CollectionDto> collections, Guid collectionId)
    {
        var lookup = collections.ToDictionary(item => item.Id, item => item.ParentId);
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
