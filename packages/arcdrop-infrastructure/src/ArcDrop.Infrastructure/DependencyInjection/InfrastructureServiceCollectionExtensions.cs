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

        return services;
    }
}
