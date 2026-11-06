using ArcDrop.Web.Services;

namespace ArcDrop.Web.Components.UI;

/// <summary>
/// Cascading action hub passed from the sidebar to collection tree nodes
/// so deeply nested nodes can request edits and deletions without prop drilling.
/// </summary>
public sealed class CollectionNodeActions
{
    private readonly Action<CollectionTreeNodeDto> _requestEdit;
    private readonly Action<CollectionTreeNodeDto> _requestDelete;

    public CollectionNodeActions(
        Action<CollectionTreeNodeDto> requestEdit,
        Action<CollectionTreeNodeDto> requestDelete)
    {
        _requestEdit = requestEdit;
        _requestDelete = requestDelete;
    }

    /// <summary>
    /// Requests the edit dialog for the supplied collection node.
    /// </summary>
    public void RequestEdit(CollectionTreeNodeDto node) => _requestEdit(node);

    /// <summary>
    /// Requests the delete confirmation for the supplied collection node.
    /// </summary>
    public void RequestDelete(CollectionTreeNodeDto node) => _requestDelete(node);
}
