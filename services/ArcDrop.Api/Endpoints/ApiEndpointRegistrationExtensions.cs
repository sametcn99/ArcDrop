namespace ArcDrop.Api.Endpoints;

/// <summary>
/// Composes all ArcDrop API endpoint modules.
/// </summary>
internal static class ApiEndpointRegistrationExtensions
{
    public static void MapArcDropEndpoints(this WebApplication app)
    {
        SystemEndpoints.MapSystem(app);
        AuthEndpoints.MapAuth(app);
        AiProviderEndpoints.MapAiProviders(app);
        AiOrganizationEndpoints.MapAiOrganization(app);
        CollectionEndpoints.MapCollections(app);
        BookmarkEndpoints.MapBookmarks(app);
        DataPortabilityEndpoints.MapDataPortability(app);
    }
}
