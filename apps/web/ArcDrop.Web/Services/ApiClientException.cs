namespace ArcDrop.Web.Services;

/// <summary>
/// Defines API failure categories used for deterministic UI messaging.
/// </summary>
public enum ApiErrorKind
{
    Network,
    Timeout,
    Unauthorized,
    NotFound,
    Validation,
    Server,
    Client
}

/// <summary>
/// Represents one normalized API failure with a user-safe message.
/// </summary>
public sealed class ApiClientException : Exception
{
    public ApiClientException(ApiErrorKind kind, string userMessage, Exception? innerException = null)
        : base(userMessage, innerException)
    {
        Kind = kind;
        UserMessage = userMessage;
    }

    public ApiErrorKind Kind { get; }

    public string UserMessage { get; }
}
