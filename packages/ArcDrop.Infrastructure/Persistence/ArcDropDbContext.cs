using ArcDrop.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace ArcDrop.Infrastructure.Persistence;

/// <summary>
/// Central EF Core DbContext for ArcDrop persistence.
/// This context is intentionally scoped to v1 bookmark domain entities and join tables,
/// allowing migration-driven schema evolution with PostgreSQL.
/// </summary>
public sealed class ArcDropDbContext(DbContextOptions<ArcDropDbContext> options) : DbContext(options)
{
    /// <summary>
    /// Bookmark aggregate roots persisted in PostgreSQL.
    /// </summary>
    public DbSet<Bookmark> Bookmarks => Set<Bookmark>();

    /// <summary>
    /// Collection aggregate roots persisted in PostgreSQL.
    /// </summary>
    public DbSet<Collection> Collections => Set<Collection>();

    /// <summary>
    /// Tag aggregate roots persisted in PostgreSQL.
    /// </summary>
    public DbSet<Tag> Tags => Set<Tag>();

    /// <summary>
    /// Join table set for bookmark-to-tag relations.
    /// </summary>
    public DbSet<BookmarkTag> BookmarkTags => Set<BookmarkTag>();

    /// <summary>
    /// Join table set for bookmark-to-collection relations.
    /// </summary>
    public DbSet<BookmarkCollectionLink> BookmarkCollectionLinks => Set<BookmarkCollectionLink>();

    /// <summary>
    /// AI provider configuration set storing encrypted provider credentials and model metadata.
    /// </summary>
    public DbSet<AiProviderConfig> AiProviderConfigs => Set<AiProviderConfig>();

    /// <summary>
    /// AI operation audit records containing operation type and success/failure metadata.
    /// </summary>
    public DbSet<AiOperationLog> AiOperationLogs => Set<AiOperationLog>();

    /// <summary>
    /// AI operation structured outputs linked to corresponding audit records.
    /// </summary>
    public DbSet<AiOperationResult> AiOperationResults => Set<AiOperationResult>();

    /// <summary>
    /// Configures schema contracts, relational keys, indexes, and constraints.
    /// The mapping is explicit to keep schema drift and accidental conventions under control.
    /// </summary>
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("public");

        modelBuilder.Entity<Bookmark>(entity =>
        {
            entity.ToTable("bookmarks");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Url).HasMaxLength(2048).IsRequired();
            entity.Property(x => x.Title).HasMaxLength(512).IsRequired();
            entity.Property(x => x.Summary).HasMaxLength(4000);
            entity.Property(x => x.CreatedAtUtc).IsRequired();
            entity.Property(x => x.UpdatedAtUtc).IsRequired();

            // Indexes prioritize expected list and search entry points for early MVP queries.
            entity.HasIndex(x => x.CreatedAtUtc).HasDatabaseName("ix_bookmarks_created_at_utc");
            entity.HasIndex(x => x.Title).HasDatabaseName("ix_bookmarks_title");
            entity.HasIndex(x => x.Url).HasDatabaseName("ix_bookmarks_url");
        });

        modelBuilder.Entity<Collection>(entity =>
        {
            entity.ToTable("collections");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(256).IsRequired();
            entity.Property(x => x.Description).HasMaxLength(2000);
            entity.Property(x => x.ParentId);
            entity.Property(x => x.CreatedAtUtc).IsRequired();
            entity.Property(x => x.UpdatedAtUtc).IsRequired();

            // Self-referencing hierarchy allows tree-based sidebar rendering and nested organization.
            entity.HasOne(x => x.Parent)
                .WithMany(x => x.Children)
                .HasForeignKey(x => x.ParentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(x => x.Name).IsUnique().HasDatabaseName("ux_collections_name");
            entity.HasIndex(x => x.ParentId).HasDatabaseName("ix_collections_parent_id");
        });

        modelBuilder.Entity<Tag>(entity =>
        {
            entity.ToTable("tags");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).HasMaxLength(128).IsRequired();
            entity.Property(x => x.NameNormalized).HasMaxLength(128).IsRequired();
            entity.Property(x => x.CreatedAtUtc).IsRequired();
            entity.Property(x => x.UpdatedAtUtc).IsRequired();

            entity.HasIndex(x => x.NameNormalized).IsUnique().HasDatabaseName("ux_tags_name_normalized");
        });

        modelBuilder.Entity<BookmarkTag>(entity =>
        {
            entity.ToTable("bookmark_tags");
            entity.HasKey(x => new { x.BookmarkId, x.TagId });

            entity.HasOne(x => x.Bookmark)
                .WithMany(x => x.Tags)
                .HasForeignKey(x => x.BookmarkId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Tag)
                .WithMany(x => x.Bookmarks)
                .HasForeignKey(x => x.TagId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.TagId).HasDatabaseName("ix_bookmark_tags_tag_id");
        });

        modelBuilder.Entity<BookmarkCollectionLink>(entity =>
        {
            entity.ToTable("bookmark_collection_links");
            entity.HasKey(x => new { x.BookmarkId, x.CollectionId });

            entity.HasOne(x => x.Bookmark)
                .WithMany(x => x.Collections)
                .HasForeignKey(x => x.BookmarkId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(x => x.Collection)
                .WithMany(x => x.Bookmarks)
                .HasForeignKey(x => x.CollectionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.CollectionId).HasDatabaseName("ix_bookmark_collection_links_collection_id");
        });

        modelBuilder.Entity<AiProviderConfig>(entity =>
        {
            entity.ToTable("ai_provider_configs");
            entity.HasKey(x => x.Id);

            entity.Property(x => x.ProviderName).HasMaxLength(128).IsRequired();
            entity.Property(x => x.ApiEndpoint).HasMaxLength(2048).IsRequired();
            entity.Property(x => x.Model).HasMaxLength(256).IsRequired();
            entity.Property(x => x.ApiKeyCipherText).HasMaxLength(4096).IsRequired();
            entity.Property(x => x.CreatedAtUtc).IsRequired();
            entity.Property(x => x.UpdatedAtUtc).IsRequired();

            entity.HasIndex(x => x.ProviderName).IsUnique().HasDatabaseName("ux_ai_provider_configs_provider_name");
            entity.HasIndex(x => x.UpdatedAtUtc).HasDatabaseName("ix_ai_provider_configs_updated_at_utc");
        });

        modelBuilder.Entity<AiOperationLog>(entity =>
        {
            entity.ToTable("ai_operations_log");
            entity.HasKey(x => x.Id);

            entity.Property(x => x.ProviderName).HasMaxLength(128).IsRequired();
            entity.Property(x => x.OperationType).HasMaxLength(64).IsRequired();
            entity.Property(x => x.BookmarkUrl).HasMaxLength(2048).IsRequired();
            entity.Property(x => x.BookmarkTitle).HasMaxLength(512).IsRequired();
            entity.Property(x => x.BookmarkSummary).HasMaxLength(4000);
            entity.Property(x => x.OutcomeStatus).HasMaxLength(16).IsRequired();
            entity.Property(x => x.FailureReason).HasMaxLength(2000);
            entity.Property(x => x.StartedAtUtc).IsRequired();
            entity.Property(x => x.CompletedAtUtc).IsRequired();

            entity.HasMany(x => x.Results)
                .WithOne(x => x.Operation)
                .HasForeignKey(x => x.OperationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(x => x.StartedAtUtc).HasDatabaseName("ix_ai_operations_log_started_at_utc");
            entity.HasIndex(x => x.ProviderName).HasDatabaseName("ix_ai_operations_log_provider_name");
            entity.HasIndex(x => x.OperationType).HasDatabaseName("ix_ai_operations_log_operation_type");
            entity.HasIndex(x => x.OutcomeStatus).HasDatabaseName("ix_ai_operations_log_outcome_status");
        });

        modelBuilder.Entity<AiOperationResult>(entity =>
        {
            entity.ToTable("ai_operation_results");
            entity.HasKey(x => x.Id);

            entity.Property(x => x.ResultType).HasMaxLength(64).IsRequired();
            entity.Property(x => x.Value).HasMaxLength(2048).IsRequired();
            entity.Property(x => x.Confidence).HasPrecision(4, 3);
            entity.Property(x => x.CreatedAtUtc).IsRequired();

            entity.HasIndex(x => x.OperationId).HasDatabaseName("ix_ai_operation_results_operation_id");
            entity.HasIndex(x => x.ResultType).HasDatabaseName("ix_ai_operation_results_result_type");
        });
    }
}
