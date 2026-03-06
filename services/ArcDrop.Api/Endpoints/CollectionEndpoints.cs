using ArcDrop.Api.Contracts;
using ArcDrop.Application.Collections;

namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Registers collection CRUD and hierarchy endpoints.
/// </summary>
internal static class CollectionEndpoints
{
    public static void MapCollections(WebApplication app)
    {
        var collectionsGroup = app.MapGroup("/api/collections").WithTags("Collections");

        collectionsGroup.MapGet("/", async (ICollectionManagementService collectionService, CancellationToken cancellationToken) =>
        {
            var collections = await collectionService.GetCollectionsAsync(cancellationToken);
            return Results.Ok(collections.Select(MapCollectionResponse).ToList());
        })
        .WithName("ListCollections")
        .WithSummary("Lists collections.")
        .WithDescription("Returns the flat collection list used by editors, selectors, and admin views.")
        .Produces<List<CollectionResponse>>(StatusCodes.Status200OK);

        collectionsGroup.MapGet("/tree", async (ICollectionManagementService collectionService, CancellationToken cancellationToken) =>
        {
            var collections = await collectionService.GetCollectionTreeAsync(cancellationToken);
            return Results.Ok(collections.Select(MapTreeNodeResponse).ToList());
        })
        .WithName("GetCollectionTree")
        .WithSummary("Returns the collection tree.")
        .WithDescription("Builds the hierarchical collection tree with nested children and bookmark previews for FR-004 collection organization flows.")
        .Produces<List<CollectionTreeNodeResponse>>(StatusCodes.Status200OK);

        collectionsGroup.MapPost("/", async (CreateCollectionRequest request, ICollectionManagementService collectionService, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Name)] = ["Collection name is required."]
                });
            }

            var result = await collectionService.CreateCollectionAsync(
                new CreateCollectionInput(request.Name, request.Description, request.ParentId),
                cancellationToken);

            if (result.Collection is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [result.ValidationTarget ?? nameof(request.Name)] = [result.ValidationError ?? "Collection create failed."]
                });
            }

            return Results.Created($"/api/collections/{result.Collection.Id}", MapCollectionResponse(result.Collection));
        })
        .WithName("CreateCollection")
        .WithSummary("Creates a collection.")
        .WithDescription("Creates a root or child collection after validating name and optional parent assignment.")
        .Accepts<CreateCollectionRequest>("application/json")
        .Produces<CollectionResponse>(StatusCodes.Status201Created)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest);

        collectionsGroup.MapPut("/{id:guid}", async (Guid id, UpdateCollectionRequest request, ICollectionManagementService collectionService, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.Name)] = ["Collection name is required."]
                });
            }

            var result = await collectionService.UpdateCollectionAsync(
                new UpdateCollectionInput(id, request.Name, request.Description, request.ParentId),
                cancellationToken);

            if (result.NotFound)
            {
                return Results.NotFound();
            }

            if (result.Collection is null)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [result.ValidationTarget ?? nameof(request.Name)] = [result.ValidationError ?? "Collection update failed."]
                });
            }

            return Results.Ok(MapCollectionResponse(result.Collection));
        })
        .WithName("UpdateCollection")
        .WithSummary("Updates a collection.")
        .WithDescription("Updates collection metadata and parent assignment while preserving unique names and rejecting hierarchy cycles.")
        .Accepts<UpdateCollectionRequest>("application/json")
        .Produces<CollectionResponse>(StatusCodes.Status200OK)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status404NotFound);

        collectionsGroup.MapDelete("/{id:guid}", async (Guid id, ICollectionManagementService collectionService, CancellationToken cancellationToken) =>
        {
            var result = await collectionService.DeleteCollectionAsync(id, cancellationToken);

            if (result.NotFound)
            {
                return Results.NotFound();
            }

            if (!result.Deleted)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [result.ValidationTarget ?? "collection"] = [result.ValidationError ?? "Collection delete failed."]
                });
            }

            return Results.NoContent();
        })
        .WithName("DeleteCollection")
        .WithSummary("Deletes a collection.")
        .WithDescription("Deletes one collection when no child collections remain attached to it.")
        .Produces(StatusCodes.Status204NoContent)
        .ProducesValidationProblem(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status404NotFound);
    }

    private static CollectionResponse MapCollectionResponse(CollectionItem collection)
    {
        return new CollectionResponse(
            collection.Id,
            collection.Name,
            collection.Description,
            collection.ParentId,
            collection.CreatedAtUtc,
            collection.UpdatedAtUtc);
    }

    private static CollectionTreeNodeResponse MapTreeNodeResponse(CollectionTreeNodeItem collection)
    {
        return new CollectionTreeNodeResponse(
            collection.Id,
            collection.Name,
            collection.Description,
            collection.ParentId,
            collection.CreatedAtUtc,
            collection.UpdatedAtUtc,
            collection.Bookmarks.Select(bookmark => new CollectionBookmarkItemResponse(
                bookmark.Id,
                bookmark.Title,
                bookmark.Url,
                bookmark.UpdatedAtUtc)).ToList(),
            collection.Children.Select(MapTreeNodeResponse).ToList());
    }
}
