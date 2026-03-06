using ArcDrop.Application.Ai;
using Microsoft.Extensions.Logging.Abstractions;

namespace ArcDrop.Api.Tests;

/// <summary>
/// Verifies AI organization orchestration after moving endpoint logic into the application layer.
/// Tests cover success, validation failure, provider lookup failure, and persistence-safe failure handling.
/// </summary>
public sealed class AiOrganizationServiceTests
{
    /// <summary>
    /// Verifies that a valid organization request persists and returns normalized results.
    /// </summary>
    [Fact]
    public async Task OrganizeAsync_WithValidInput_ReturnsSuccessfulOperation()
    {
        var store = new StubOperationStore(providerExists: true);
        var service = new AiOrganizationService(
            new StubSuggestionService(),
            store,
            NullLogger<AiOrganizationService>.Instance);

        var result = await service.OrganizeAsync(
            new OrganizeBookmarkInput("OpenAI", "tag-suggestions", "https://example.com", "Example Title", "Summary"),
            CancellationToken.None);

        Assert.NotNull(result.Operation);
        Assert.True(result.ProviderFound);
        Assert.False(result.ProcessingFailed);
        Assert.Equal("success", result.Operation!.OutcomeStatus);
        Assert.NotEmpty(result.Operation.Results);
    }

    /// <summary>
    /// Verifies that unsupported operation types are rejected before persistence work begins.
    /// </summary>
    [Fact]
    public async Task OrganizeAsync_WithInvalidOperationType_ReturnsValidationError()
    {
        var store = new StubOperationStore(providerExists: true);
        var service = new AiOrganizationService(
            new StubSuggestionService(normalizedOperationType: null),
            store,
            NullLogger<AiOrganizationService>.Instance);

        var result = await service.OrganizeAsync(
            new OrganizeBookmarkInput("OpenAI", "invalid", "https://example.com", "Example Title", null),
            CancellationToken.None);

        Assert.Null(result.Operation);
        Assert.Equal("OperationType", result.ValidationTarget);
        Assert.False(result.ProcessingFailed);
    }

    /// <summary>
    /// Verifies that missing provider profiles are surfaced as not-found without creating an operation log.
    /// </summary>
    [Fact]
    public async Task OrganizeAsync_WithMissingProvider_ReturnsNotFoundResult()
    {
        var store = new StubOperationStore(providerExists: false);
        var service = new AiOrganizationService(
            new StubSuggestionService(),
            store,
            NullLogger<AiOrganizationService>.Instance);

        var result = await service.OrganizeAsync(
            new OrganizeBookmarkInput("Missing", "tag-suggestions", "https://example.com", "Example Title", null),
            CancellationToken.None);

        Assert.Null(result.Operation);
        Assert.False(result.ProviderFound);
        Assert.Equal(Guid.Empty, store.CreatedOperationId);
    }

    /// <summary>
    /// Verifies that suggestion generation failures mark the operation as failed instead of leaking exceptions.
    /// </summary>
    [Fact]
    public async Task OrganizeAsync_WhenSuggestionGenerationFails_ReturnsProcessingFailure()
    {
        var store = new StubOperationStore(providerExists: true);
        var service = new AiOrganizationService(
            new ThrowingSuggestionService(),
            store,
            NullLogger<AiOrganizationService>.Instance);

        var result = await service.OrganizeAsync(
            new OrganizeBookmarkInput("OpenAI", "tag-suggestions", "https://example.com", "Example Title", null),
            CancellationToken.None);

        Assert.Null(result.Operation);
        Assert.True(result.ProcessingFailed);
        Assert.Equal(store.CreatedOperationId, store.FailedOperationId);
    }

    private sealed class StubSuggestionService(string? normalizedOperationType = "tag-suggestions") : IOrganizationSuggestionService
    {
        public string? NormalizeOperationType(string rawOperationType)
        {
            return normalizedOperationType;
        }

        public IReadOnlyList<OrganizationSuggestionItem> GenerateResults(string normalizedOperationType, string title, string? summary, string url)
        {
            return [new OrganizationSuggestionItem("tag", "example", 0.9m)];
        }
    }

    private sealed class ThrowingSuggestionService : IOrganizationSuggestionService
    {
        public string? NormalizeOperationType(string rawOperationType)
        {
            return "tag-suggestions";
        }

        public IReadOnlyList<OrganizationSuggestionItem> GenerateResults(string normalizedOperationType, string title, string? summary, string url)
        {
            throw new InvalidOperationException("Synthetic failure");
        }
    }

    private sealed class StubOperationStore(bool providerExists) : IAiOrganizationOperationStore
    {
        public Guid CreatedOperationId { get; private set; }

        public Guid FailedOperationId { get; private set; }

        public Task<bool> ProviderExistsAsync(string providerName, CancellationToken cancellationToken)
        {
            return Task.FromResult(providerExists);
        }

        public Task<Guid> CreatePendingOperationAsync(string providerName, string operationType, string bookmarkUrl, string bookmarkTitle, string? bookmarkSummary, DateTimeOffset startedAtUtc, CancellationToken cancellationToken)
        {
            CreatedOperationId = Guid.NewGuid();
            return Task.FromResult(CreatedOperationId);
        }

        public Task<AiOrganizationOperationItem> CompleteSuccessfulOperationAsync(Guid operationId, IReadOnlyList<AiOrganizationResultItem> results, DateTimeOffset completedAtUtc, CancellationToken cancellationToken)
        {
            return Task.FromResult(new AiOrganizationOperationItem(
                operationId,
                "OpenAI",
                "tag-suggestions",
                "success",
                completedAtUtc.AddSeconds(-1),
                completedAtUtc,
                results));
        }

        public Task<AiOrganizationOperationItem?> CompleteFailedOperationAsync(Guid operationId, string failureReason, DateTimeOffset completedAtUtc, CancellationToken cancellationToken)
        {
            FailedOperationId = operationId;
            return Task.FromResult<AiOrganizationOperationItem?>(null);
        }

        public Task<AiOrganizationOperationItem?> GetOperationAsync(Guid operationId, CancellationToken cancellationToken)
        {
            return Task.FromResult<AiOrganizationOperationItem?>(null);
        }
    }
}