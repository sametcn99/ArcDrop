namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents create input for collection add workflows.
/// </summary>
public sealed record CreateCollectionInput(string Name, string? Description, Guid? ParentId);