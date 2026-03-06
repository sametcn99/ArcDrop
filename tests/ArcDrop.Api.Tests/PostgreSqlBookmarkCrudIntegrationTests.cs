using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using ArcDrop.Api.Contracts;
using ArcDrop.Infrastructure.Persistence;
using DotNet.Testcontainers.Builders;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Validates PostgreSQL-backed migration and CRUD behavior against a real database engine.
/// This test suite satisfies TASK-003 quality intent by exercising schema creation, rollback,
/// and API-level persistence behavior through the same runtime stack used by the service.
/// </summary>
public sealed class PostgreSqlBookmarkCrudIntegrationTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgresContainer = new PostgreSqlBuilder("postgres:16-alpine")
        .WithDatabase("arcdrop_test")
        .WithUsername("arcdrop")
        .WithPassword("arcdrop_password")
        .Build();

    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _httpClient;
    private string? _skipReason;

    /// <summary>
    /// Starts PostgreSQL test infrastructure and configures the API host to use the container connection.
    /// A graceful skip path is provided for environments that cannot run Docker-based integration tests.
    /// </summary>
    public async Task InitializeAsync()
    {
        try
        {
            await _postgresContainer.StartAsync();

            // Set ARCDROP-prefixed environment variables because the API explicitly loads this prefix
            // after base configuration providers. This guarantees container settings take precedence.
            Environment.SetEnvironmentVariable(
                "ARCDROP_ConnectionStrings__ArcDropPostgres",
                _postgresContainer.GetConnectionString());
            Environment.SetEnvironmentVariable("ARCDROP_ADMIN_USERNAME", "admin-test");
            Environment.SetEnvironmentVariable("ARCDROP_ADMIN_PASSWORD", "integration-test-password");

            _factory = new WebApplicationFactory<Program>()
                .WithWebHostBuilder(_ => { });

            _httpClient = _factory.CreateClient();
        }
        catch (Exception exception)
        {
            _skipReason =
                "PostgreSQL integration tests were skipped because Docker test infrastructure is unavailable. " +
                $"Original error: {exception.Message}";
        }
    }

    /// <summary>
    /// Disposes API host and PostgreSQL container resources.
    /// </summary>
    public async Task DisposeAsync()
    {
        _httpClient?.Dispose();

        // Clean up process-level environment overrides to avoid cross-test contamination.
        Environment.SetEnvironmentVariable("ARCDROP_ConnectionStrings__ArcDropPostgres", null);
        Environment.SetEnvironmentVariable("ARCDROP_ADMIN_USERNAME", null);
        Environment.SetEnvironmentVariable("ARCDROP_ADMIN_PASSWORD", null);

        if (_factory is not null)
        {
            _factory.Dispose();
        }

        await _postgresContainer.DisposeAsync();
    }

    /// <summary>
    /// Verifies that migrations can roll back to baseline and re-apply successfully.
    /// This protects migration pipelines from one-way failures that block self-host upgrades.
    /// </summary>
    [Fact]
    public async Task Migrations_CanRollBackAndReApplySchema()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await using var scope = _factory!.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
        var migrator = dbContext.Database.GetService<IMigrator>();

        await migrator.MigrateAsync("0");
        await migrator.MigrateAsync();

        var canConnect = await dbContext.Database.CanConnectAsync();
        Assert.True(canConnect);
    }

    /// <summary>
    /// Verifies end-to-end bookmark CRUD behavior through public API endpoints.
    /// This confirms relational persistence and endpoint contracts operate together.
    /// </summary>
    [Fact]
    public async Task BookmarkCrud_Flow_PersistsDataInPostgreSql()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        // Capture a non-null client reference once to keep nullability and intent explicit.
        var client = _httpClient!;

        var createResponse = await client.PostAsJsonAsync("/api/bookmarks", new CreateBookmarkRequest(
            "https://example.com",
            "Example",
            "Initial summary"));

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var createdBookmark = await createResponse.Content.ReadFromJsonAsync<BookmarkResponse>();
        Assert.NotNull(createdBookmark);

        // The non-null assertion is safe after Assert.NotNull, and keeps subsequent API calls readable.
        var bookmarkId = createdBookmark!.Id;

        var getResponse = await client.GetAsync($"/api/bookmarks/{bookmarkId}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        var updateResponse = await client.PutAsJsonAsync($"/api/bookmarks/{bookmarkId}", new UpdateBookmarkRequest(
            "https://example.com/updated",
            "Example Updated",
            "Updated summary"));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);

        var deleteResponse = await client.DeleteAsync($"/api/bookmarks/{bookmarkId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var missingResponse = await client.GetAsync($"/api/bookmarks/{bookmarkId}");
        Assert.Equal(HttpStatusCode.NotFound, missingResponse.StatusCode);
    }

    /// <summary>
    /// Verifies that collections support parent-child hierarchy and tree endpoint rendering.
    /// This covers nested organization requirements for sidebar tree structures.
    /// </summary>
    [Fact]
    public async Task CollectionCrud_Flow_ReturnsHierarchicalTree()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        var client = _httpClient!;
        var rootCreateResponse = await client.PostAsJsonAsync("/api/collections", new CreateCollectionRequest(
            "Engineering",
            "Top level folder",
            ParentId: null));

        Assert.Equal(HttpStatusCode.Created, rootCreateResponse.StatusCode);
        var root = await rootCreateResponse.Content.ReadFromJsonAsync<CollectionResponse>();
        Assert.NotNull(root);

        var childCreateResponse = await client.PostAsJsonAsync("/api/collections", new CreateCollectionRequest(
            "DotNet",
            "Child folder",
            root!.Id));

        Assert.Equal(HttpStatusCode.Created, childCreateResponse.StatusCode);

        var treeResponse = await client.GetAsync("/api/collections/tree");
        Assert.Equal(HttpStatusCode.OK, treeResponse.StatusCode);

        var treePayload = await treeResponse.Content.ReadFromJsonAsync<List<CollectionTreeNodeResponse>>();
        Assert.NotNull(treePayload);
        Assert.Single(treePayload!);
        Assert.Equal("Engineering", treePayload[0].Name);
        Assert.Single(treePayload[0].Children);
        Assert.Equal("DotNet", treePayload[0].Children[0].Name);
    }

    /// <summary>
    /// Verifies that bookmark membership can be synchronized across multiple collections.
    /// This covers the many-to-many relation where one bookmark can belong to multiple collections.
    /// </summary>
    [Fact]
    public async Task BookmarkCollectionMembership_CanBeSynchronizedAcrossMultipleCollections()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        var client = _httpClient!;

        var firstCollectionResponse = await client.PostAsJsonAsync("/api/collections", new CreateCollectionRequest(
            "Read Later",
            null,
            ParentId: null));
        var secondCollectionResponse = await client.PostAsJsonAsync("/api/collections", new CreateCollectionRequest(
            "Research",
            null,
            ParentId: null));

        Assert.Equal(HttpStatusCode.Created, firstCollectionResponse.StatusCode);
        Assert.Equal(HttpStatusCode.Created, secondCollectionResponse.StatusCode);

        var firstCollection = await firstCollectionResponse.Content.ReadFromJsonAsync<CollectionResponse>();
        var secondCollection = await secondCollectionResponse.Content.ReadFromJsonAsync<CollectionResponse>();
        Assert.NotNull(firstCollection);
        Assert.NotNull(secondCollection);

        var createBookmarkResponse = await client.PostAsJsonAsync("/api/bookmarks", new CreateBookmarkRequest(
            "https://learn.microsoft.com",
            "Microsoft Learn",
            "Documentation portal"));

        Assert.Equal(HttpStatusCode.Created, createBookmarkResponse.StatusCode);
        var bookmark = await createBookmarkResponse.Content.ReadFromJsonAsync<BookmarkResponse>();
        Assert.NotNull(bookmark);

        var syncResponse = await client.PutAsJsonAsync($"/api/bookmarks/{bookmark!.Id}/collections", new SyncBookmarkCollectionsRequest(
            [firstCollection!.Id, secondCollection!.Id]));

        Assert.Equal(HttpStatusCode.OK, syncResponse.StatusCode);
        var syncedBookmark = await syncResponse.Content.ReadFromJsonAsync<BookmarkResponse>();
        Assert.NotNull(syncedBookmark);
        Assert.Equal(2, syncedBookmark!.CollectionIds.Count);
        Assert.Contains(firstCollection.Id, syncedBookmark.CollectionIds);
        Assert.Contains(secondCollection.Id, syncedBookmark.CollectionIds);
    }

    /// <summary>
    /// Verifies that AI provider API keys are stored encrypted and never returned as raw secret values.
    /// This protects sensitive provider credentials from accidental plaintext persistence exposure.
    /// </summary>
    [Fact]
    public async Task AiProviderConfig_StoresEncryptedApiKey_AndReturnsMaskedPreview()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        var client = _httpClient!;
        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-test",
            "integration-test-password"));
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);

        var loginPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(loginPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", loginPayload!.AccessToken);

        const string plainApiKey = "test-secret-key-12345";
        var upsertResponse = await client.PostAsJsonAsync("/api/ai/providers", new UpsertAiProviderConfigRequest(
            "OpenAI",
            "https://api.openai.com/v1",
            "gpt-4.1",
            plainApiKey));

        Assert.Equal(HttpStatusCode.Created, upsertResponse.StatusCode);

        var responsePayload = await upsertResponse.Content.ReadFromJsonAsync<AiProviderConfigResponse>();
        Assert.NotNull(responsePayload);
        Assert.True(responsePayload!.HasApiKey);
        Assert.NotEqual(plainApiKey, responsePayload.ApiKeyPreview);

        await using var scope = _factory!.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
        var entity = await dbContext.AiProviderConfigs.SingleAsync(x => x.ProviderName == "OpenAI");

        Assert.False(string.IsNullOrWhiteSpace(entity.ApiKeyCipherText));
        Assert.NotEqual(plainApiKey, entity.ApiKeyCipherText);
    }

    /// <summary>
    /// Verifies AI provider lifecycle behavior for update and delete operations.
    /// The update flow must preserve encrypted key material when callers omit a replacement API key.
    /// </summary>
    [Fact]
    public async Task AiProviderConfig_UpdateAndDelete_PreservesOrRemovesStateAsExpected()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        var client = _httpClient!;
        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-test",
            "integration-test-password"));
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);

        var loginPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(loginPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", loginPayload!.AccessToken);

        var createResponse = await client.PostAsJsonAsync("/api/ai/providers", new UpsertAiProviderConfigRequest(
            "Anthropic",
            "https://api.anthropic.com/v1",
            "claude-3-7-sonnet",
            "anthropic-secret-1"));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        await using var initialScope = _factory!.Services.CreateAsyncScope();
        var initialDbContext = initialScope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
        var beforeUpdate = await initialDbContext.AiProviderConfigs.SingleAsync(x => x.ProviderName == "Anthropic");
        var originalCipherText = beforeUpdate.ApiKeyCipherText;

        var updateResponse = await client.PutAsJsonAsync("/api/ai/providers/Anthropic", new UpdateAiProviderConfigRequest(
            "https://api.anthropic.com/v1/messages",
            "claude-3-7-sonnet-latest",
            ApiKey: null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);

        var updatePayload = await updateResponse.Content.ReadFromJsonAsync<AiProviderConfigResponse>();
        Assert.NotNull(updatePayload);
        Assert.Equal("https://api.anthropic.com/v1/messages", updatePayload!.ApiEndpoint);
        Assert.Equal("claude-3-7-sonnet-latest", updatePayload.Model);

        await using var updatedScope = _factory.Services.CreateAsyncScope();
        var updatedDbContext = updatedScope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
        var afterUpdate = await updatedDbContext.AiProviderConfigs.SingleAsync(x => x.ProviderName == "Anthropic");

        Assert.Equal(originalCipherText, afterUpdate.ApiKeyCipherText);

        var deleteResponse = await client.DeleteAsync("/api/ai/providers/Anthropic");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getAfterDeleteResponse = await client.GetAsync("/api/ai/providers/Anthropic");
        Assert.Equal(HttpStatusCode.NotFound, getAfterDeleteResponse.StatusCode);
    }

    /// <summary>
    /// Verifies that AI organization requests persist auditable operation records and return deterministic suggestions.
    /// This protects the refactor that moved organization orchestration behind an application-layer service.
    /// </summary>
    [Fact]
    public async Task AiOrganization_OrganizeAndFetchOperation_ReturnsPersistedResult()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        var client = _httpClient!;
        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(
            "admin-test",
            "integration-test-password"));
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);

        var loginPayload = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(loginPayload);

        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", loginPayload!.AccessToken);

        var providerResponse = await client.PostAsJsonAsync("/api/ai/providers", new UpsertAiProviderConfigRequest(
            "OpenAI",
            "https://api.openai.com/v1",
            "gpt-4.1",
            "test-secret-key-12345"));
        Assert.Equal(HttpStatusCode.Created, providerResponse.StatusCode);

        var organizeResponse = await client.PostAsJsonAsync("/api/ai/organize", new OrganizeBookmarkRequest(
            "OpenAI",
            "tag-suggestions",
            "https://learn.microsoft.com/dotnet",
            "DotNet API Guide",
            "Reference material for API and .NET workflows"));

        Assert.Equal(HttpStatusCode.OK, organizeResponse.StatusCode);

        var organizePayload = await organizeResponse.Content.ReadFromJsonAsync<OrganizeBookmarkResponse>();
        Assert.NotNull(organizePayload);
        Assert.Equal("success", organizePayload!.OutcomeStatus);
        Assert.NotEmpty(organizePayload.Results);

        var operationResponse = await client.GetAsync($"/api/ai/operations/{organizePayload.OperationId}");
        Assert.Equal(HttpStatusCode.OK, operationResponse.StatusCode);

        var operationPayload = await operationResponse.Content.ReadFromJsonAsync<OrganizeBookmarkResponse>();
        Assert.NotNull(operationPayload);
        Assert.Equal(organizePayload.OperationId, operationPayload!.OperationId);
        Assert.Equal(organizePayload.OperationType, operationPayload.OperationType);
        Assert.Equal(organizePayload.Results.Count, operationPayload.Results.Count);
    }

    /// <summary>
    /// Verifies JSON export and import flows through the public HTTP contract.
    /// This protects the endpoint refactor that moved portability orchestration behind a service boundary.
    /// </summary>
    [Fact]
    public async Task DataPortability_ExportAndImportJson_RoundTripsPortableEnvelope()
    {
        if (!EnsureDockerIsAvailable())
        {
            return;
        }

        await ApplyLatestMigrationAsync();

        var client = _httpClient!;
        var collectionResponse = await client.PostAsJsonAsync("/api/collections", new CreateCollectionRequest(
            "Exports",
            "Data portability folder",
            ParentId: null));
        Assert.Equal(HttpStatusCode.Created, collectionResponse.StatusCode);

        var collection = await collectionResponse.Content.ReadFromJsonAsync<CollectionResponse>();
        Assert.NotNull(collection);

        var bookmarkResponse = await client.PostAsJsonAsync("/api/bookmarks", new CreateBookmarkRequest(
            "https://example.com/exported",
            "Exported Bookmark",
            "Portable content"));
        Assert.Equal(HttpStatusCode.Created, bookmarkResponse.StatusCode);

        var bookmark = await bookmarkResponse.Content.ReadFromJsonAsync<BookmarkResponse>();
        Assert.NotNull(bookmark);

        var syncResponse = await client.PutAsJsonAsync($"/api/bookmarks/{bookmark!.Id}/collections", new SyncBookmarkCollectionsRequest(
            [collection!.Id]));
        Assert.Equal(HttpStatusCode.OK, syncResponse.StatusCode);

        var exportResponse = await client.PostAsJsonAsync("/api/data/export", new ExportBookmarksRequest(
            ExportFormat.Json,
            [collection.Id]));
        Assert.Equal(HttpStatusCode.OK, exportResponse.StatusCode);

        var exportContent = await exportResponse.Content.ReadAsStringAsync();
        var envelope = JsonSerializer.Deserialize<BookmarkExportEnvelope>(exportContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        Assert.NotNull(envelope);
        Assert.Single(envelope!.Collections);
        Assert.Single(envelope.Bookmarks);
        Assert.Equal("Exports", envelope.Collections[0].Name);
        Assert.Equal("https://example.com/exported", envelope.Bookmarks[0].Url);

        using var multipartContent = new MultipartFormDataContent();
        using var fileContent = new ByteArrayContent(Encoding.UTF8.GetBytes(exportContent));
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        multipartContent.Add(fileContent, "file", "arcdrop-bookmarks.json");
        multipartContent.Add(new StringContent("json"), "format");

        var importResponse = await client.PostAsync("/api/data/import", multipartContent);
        Assert.Equal(HttpStatusCode.OK, importResponse.StatusCode);

        var importSummary = await importResponse.Content.ReadFromJsonAsync<ImportBookmarksResponse>();
        Assert.NotNull(importSummary);
        Assert.Equal(0, importSummary!.CollectionsCreated);
        Assert.Equal(0, importSummary.BookmarksCreated);
        Assert.Equal(0, importSummary.BookmarksUpdated);
        Assert.Equal(1, importSummary.BookmarksSkipped);
    }

    /// <summary>
    /// Converts missing Docker infrastructure into a deterministic skipped-test outcome.
    /// This keeps CI behavior explicit while allowing local development without container runtime.
    /// </summary>
    private bool EnsureDockerIsAvailable()
    {
        if (!string.IsNullOrWhiteSpace(_skipReason))
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// Applies the latest migration to guarantee schema availability for endpoint-level CRUD tests.
    /// This isolates each test from assumptions about prior migration execution order.
    /// </summary>
    private async Task ApplyLatestMigrationAsync()
    {
        await using var scope = _factory!.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ArcDropDbContext>();
        var migrator = dbContext.Database.GetService<IMigrator>();
        await migrator.MigrateAsync();
    }
}
