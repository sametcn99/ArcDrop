namespace ArcDrop.Application.Collections;

/// <summary>
/// Represents update input for collection edit workflows.
/// </summary>
public sealed record UpdateCollectionInput(Guid Id, string Name, string? Description, Guid? ParentId);