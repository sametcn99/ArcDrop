using System.Globalization;

namespace ArcDrop.Api.Configuration;

/// <summary>
/// Centralizes environment/bootstrap configuration flow so Program.cs remains a composition root.
/// </summary>
internal static class EnvironmentConfigurationBootstrapper
{
    /// <summary>
    /// Loads ARCDROP_* configuration values from discovered .env sources and applies flat key mappings
    /// into typed configuration sections used by option binding.
    /// </summary>
    public static void Bootstrap(ConfigurationManager configuration)
    {
        LoadDotEnvValues();

        // Explicitly load ArcDrop-prefixed environment variables so self-host deployments can keep secrets
        // outside source-controlled files.
        configuration.AddEnvironmentVariables(prefix: "ARCDROP_");

        // Map flat ARCDROP_* keys from .env to typed options sections.
        ApplyEnvBackedConfiguration(configuration);
    }

    /// <summary>
    /// Applies localhost PostgreSQL fallback when connection string is missing or still placeholder-based.
    /// </summary>
    public static void TryApplyPostgresLocalFallback(ConfigurationManager configuration)
    {
        var configuredConnectionString = configuration.GetConnectionString("ArcDropPostgres");
        if (!ShouldUsePostgresEnvironmentFallback(configuredConnectionString))
        {
            return;
        }

        var postgresDatabase = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_DB");
        var postgresUser = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_USER");
        var postgresPassword = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_PASSWORD");
        var postgresPort = Environment.GetEnvironmentVariable("ARCDROP_POSTGRES_PORT");

        // Local debugging may run API outside Docker while credentials still live in env files.
        if (!string.IsNullOrWhiteSpace(postgresDatabase) &&
            !string.IsNullOrWhiteSpace(postgresUser) &&
            !string.IsNullOrWhiteSpace(postgresPassword))
        {
            var normalizedPort = int.TryParse(postgresPort, NumberStyles.None, CultureInfo.InvariantCulture, out var parsedPort)
                ? parsedPort
                : 5432;

            var fallbackConnectionString =
                $"Host=localhost;Port={normalizedPort};Database={postgresDatabase};Username={postgresUser};Password={postgresPassword}";

            configuration["ConnectionStrings:ArcDropPostgres"] = fallbackConnectionString;
        }
    }

    private static bool ShouldUsePostgresEnvironmentFallback(string? configuredConnectionString)
    {
        if (string.IsNullOrWhiteSpace(configuredConnectionString))
        {
            return true;
        }

        // Placeholder values are intentionally treated as unresolved credentials.
        return configuredConnectionString.Contains("ChangeThis", StringComparison.OrdinalIgnoreCase);
    }

    private static void ApplyEnvBackedConfiguration(ConfigurationManager configuration)
    {
        // Support both flat and double-underscore env key styles to keep local/dev/test hosts compatible.
        SetConfigFromEnvAliases(configuration, "Admin:Username", "ARCDROP_ADMIN_USERNAME", "ARCDROP_Admin__Username");
        SetConfigFromEnvAliases(configuration, "Admin:Password", "ARCDROP_ADMIN_PASSWORD", "ARCDROP_Admin__Password");

        SetConfigFromEnvAliases(configuration, "Jwt:Issuer", "ARCDROP_JWT_ISSUER", "ARCDROP_Jwt__Issuer");
        SetConfigFromEnvAliases(configuration, "Jwt:Audience", "ARCDROP_JWT_AUDIENCE", "ARCDROP_Jwt__Audience");
        SetConfigFromEnvAliases(configuration, "Jwt:SigningKey", "ARCDROP_JWT_SIGNING_KEY", "ARCDROP_Jwt__SigningKey");
        SetConfigFromEnvAliases(configuration, "Jwt:AccessTokenLifetimeMinutes", "ARCDROP_JWT_ACCESS_TOKEN_LIFETIME_MINUTES", "ARCDROP_Jwt__AccessTokenLifetimeMinutes");

        SetConfigFromEnvAliases(configuration, "AdminCredentialPolicy:MinimumPasswordLength", "ARCDROP_ADMIN_CREDENTIAL_POLICY_MINIMUM_PASSWORD_LENGTH", "ARCDROP_AdminCredentialPolicy__MinimumPasswordLength");
        SetConfigFromEnvAliases(configuration, "AdminCredentialPolicy:RequireUppercase", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_UPPERCASE", "ARCDROP_AdminCredentialPolicy__RequireUppercase");
        SetConfigFromEnvAliases(configuration, "AdminCredentialPolicy:RequireLowercase", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_LOWERCASE", "ARCDROP_AdminCredentialPolicy__RequireLowercase");
        SetConfigFromEnvAliases(configuration, "AdminCredentialPolicy:RequireDigit", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_DIGIT", "ARCDROP_AdminCredentialPolicy__RequireDigit");
        SetConfigFromEnvAliases(configuration, "AdminCredentialPolicy:RequireSpecialCharacter", "ARCDROP_ADMIN_CREDENTIAL_POLICY_REQUIRE_SPECIAL_CHARACTER", "ARCDROP_AdminCredentialPolicy__RequireSpecialCharacter");
        SetConfigFromEnvAliases(configuration, "AdminCredentialPolicy:DisallowPasswordReuse", "ARCDROP_ADMIN_CREDENTIAL_POLICY_DISALLOW_PASSWORD_REUSE", "ARCDROP_AdminCredentialPolicy__DisallowPasswordReuse");
    }

    private static void SetConfigFromEnvAliases(ConfigurationManager configuration, string key, params string[] envNames)
    {
        foreach (var envName in envNames)
        {
            var value = Environment.GetEnvironmentVariable(envName);
            if (!string.IsNullOrWhiteSpace(value))
            {
                configuration[key] = value;
                return;
            }
        }
    }

    private static void LoadDotEnvValues()
    {
        foreach (var envFilePath in EnumerateDotEnvCandidates())
        {
            if (!File.Exists(envFilePath))
            {
                continue;
            }

            foreach (var rawLine in File.ReadLines(envFilePath))
            {
                var line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith('#'))
                {
                    continue;
                }

                var separatorIndex = line.IndexOf('=');
                if (separatorIndex <= 0)
                {
                    continue;
                }

                var key = line[..separatorIndex].Trim();
                var value = line[(separatorIndex + 1)..].Trim();

                // Keep existing process-level values authoritative and avoid logging secret material.
                if (!string.IsNullOrWhiteSpace(key) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                {
                    Environment.SetEnvironmentVariable(key, value);
                }
            }

            // First discovered .env source wins to keep resolution deterministic.
            break;
        }
    }

    private static IEnumerable<string> EnumerateDotEnvCandidates()
    {
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var currentDirectory = new DirectoryInfo(Directory.GetCurrentDirectory());

        while (currentDirectory is not null)
        {
            var localEnv = Path.Combine(currentDirectory.FullName, ".env");
            if (visited.Add(localEnv))
            {
                yield return localEnv;
            }

            var repoOpsEnv = Path.Combine(currentDirectory.FullName, "ops", "docker", ".env");
            if (visited.Add(repoOpsEnv))
            {
                yield return repoOpsEnv;
            }

            currentDirectory = currentDirectory.Parent;
        }
    }
}
