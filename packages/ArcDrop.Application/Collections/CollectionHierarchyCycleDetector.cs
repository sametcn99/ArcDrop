namespace ArcDrop.Application.Collections;

/// <summary>
/// Evaluates whether assigning a new parent would introduce a cycle into the collection hierarchy.
/// </summary>
public static class CollectionHierarchyCycleDetector
{
    /// <summary>
    /// Returns true when <paramref name="candidateParentId"/> is already a descendant of <paramref name="movingCollectionId"/>.
    /// </summary>
    public static bool WouldCreateCycle(
        Guid movingCollectionId,
        Guid candidateParentId,
        IReadOnlyList<(Guid Id, Guid? ParentId)> hierarchyItems)
    {
        var parentLookup = hierarchyItems.ToDictionary(item => item.Id, item => item.ParentId);
        var currentParentId = candidateParentId;

        while (true)
        {
            if (currentParentId == movingCollectionId)
            {
                return true;
            }

            if (!parentLookup.TryGetValue(currentParentId, out var nextParentId) || nextParentId is null)
            {
                return false;
            }

            currentParentId = nextParentId.Value;
        }
    }
}
