using System.IO;
using System.Text.Json;

namespace ArcDrop.Avalonia.Services;

/// <summary>
/// File-backed admin session store kept under the OS application-data directory.
/// </summary>
public sealed class FileApiAuthSession : IApiAuthSession
{
    private sealed record SessionPayload(string Username, string AccessToken, long ExpiresAtUnix);

    private readonly string _sessionFilePath;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public FileApiAuthSession()
    {
        var appDataDirectory = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var arcdropDirectory = Path.Combine(appDataDirectory, "arcdrop-avalonia");
        Directory.CreateDirectory(arcdropDirectory);
        _sessionFilePath = Path.Combine(arcdropDirectory, "session.json");
    }

    public bool IsAuthenticated => GetValidToken() is not null;

    public string? Username => ReadSession()?.Username;

    public DateTimeOffset? ExpiresAtUtc
    {
        get
        {
            var session = ReadSession();
            return session is null ? null : DateTimeOffset.FromUnixTimeSeconds(session.ExpiresAtUnix);
        }
    }

    /// <inheritdoc />
    public string? GetValidToken()
    {
        var session = ReadSession();
        if (session is null || string.IsNullOrWhiteSpace(session.AccessToken))
        {
            return null;
        }

        if (DateTimeOffset.FromUnixTimeSeconds(session.ExpiresAtUnix) <= DateTimeOffset.UtcNow)
        {
            // Expired sessions fail closed so callers are pushed back to the login flow.
            return null;
        }

        return session.AccessToken;
    }

    /// <inheritdoc />
    public void SignIn(string username, string accessToken, DateTimeOffset expiresAtUtc)
    {
        WriteSession(new SessionPayload(username, accessToken, expiresAtUtc.ToUnixTimeSeconds()));
    }

    /// <inheritdoc />
    public void SignOut()
    {
        try
        {
            File.Delete(_sessionFilePath);
        }
        catch (IOException)
        {
            // A locked or missing session file simply falls back to signed-out state.
        }
    }

    private SessionPayload? ReadSession()
    {
        try
        {
            if (!File.Exists(_sessionFilePath))
            {
                return null;
            }

            var json = File.ReadAllText(_sessionFilePath);
            return JsonSerializer.Deserialize<SessionPayload>(json, _jsonOptions);
        }
        catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private void WriteSession(SessionPayload payload)
    {
        try
        {
            var json = JsonSerializer.Serialize(payload, _jsonOptions);
            File.WriteAllText(_sessionFilePath, json);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Session persistence failures surface as signed-out state on the next start.
        }
    }
}
