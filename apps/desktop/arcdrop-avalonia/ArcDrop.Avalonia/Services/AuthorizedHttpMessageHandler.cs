namespace ArcDrop.Avalonia.Services;

/// <summary>
/// Attaches the stored admin bearer token to outgoing ArcDrop API requests
/// and clears the session when the API reports the token unauthorized.
/// </summary>
public sealed class AuthorizedHttpMessageHandler(IApiAuthSession authSession) : DelegatingHandler
{
    /// <inheritdoc />
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (authSession.GetValidToken() is { } token)
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        var response = await base.SendAsync(request, cancellationToken);

        if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            // Fail closed: a rejected token means the desktop session must sign in again.
            authSession.SignOut();
        }

        return response;
    }
}
