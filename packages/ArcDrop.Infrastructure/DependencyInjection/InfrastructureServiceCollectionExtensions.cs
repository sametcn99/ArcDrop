using ArcDrop.Application.Bookmarks;
using ArcDrop.Application.Collections;
using ArcDrop.Application.Ai;
using ArcDrop.Application.Portability;
using ArcDrop.Infrastructure.Ai;
using ArcDrop.Infrastructure.Bookmarks;
using ArcDrop.Infrastructure.Collections;
using ArcDrop.Infrastructure.Portability;
using ArcDrop.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ArcDrop.Infrastructure.DependencyInjection;

/// <summary>
/// Registers ArcDrop infrastructure services for the composition root.
/// This extension keeps persistence wiring centralized and testable.
/// </summary>
public static class InfrastructureServiceCollectionExtensions
{
    /// <summary>
    /// Adds PostgreSQL-backed persistence services and validates required configuration.
    /// </summary>
    public static IServiceCollection AddArcDropInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        const string connectionName = "ArcDropPostgres";
        var connectionString = configuration.GetConnectionString(connectionName);

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"Connection string '{connectionName}' is missing. Configure it in appsettings or ARCDROP_ environment variables.");
        }

        // Enable resilient PostgreSQL execution strategy for transient network failures common in self-host setups.
        services.AddDbContext<ArcDropDbContext>(options =>
            options.UseNpgsql(connectionString, npgsqlOptions =>
            {
                npgsqlOptions.MigrationsAssembly(typeof(ArcDropDbContext).Assembly.FullName);
                npgsqlOptions.EnableRetryOnFailure(maxRetryCount: 5);
            }));

        // Register persistence-backed bookmark workflows once so composition roots can consume application contracts.
        services.AddScoped<IBookmarkManagementService, EfCoreBookmarkManagementService>();
        services.AddScoped<ICollectionManagementService, EfCoreCollectionManagementService>();
        services.AddScoped<IAiProviderConfigService, EfCoreAiProviderConfigService>();
        services.AddScoped<IAiOrganizationOperationStore, EfCoreAiOrganizationOperationStore>();
        services.AddScoped<IAiOrganizationService, AiOrganizationService>();
        services.AddScoped<IDataPortabilityService, EfCoreDataPortabilityService>();

        return services;
    }
}
