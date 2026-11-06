using Microsoft.AspNetCore.Components;

namespace ArcDrop.Web.Services;

/// <summary>
/// Centralizes the session-expiry redirect so pages fail fast to the login flow
/// instead of surfacing raw unauthorized errors inside an interactive circuit.
/// </summary>
public static class SessionRedirect
{
    /// <summary>
    /// Returns true when the supplied exception should terminate the current view
    /// and send the user back to the login page.
    /// </summary>
    public static bool ShouldRedirect(ApiClientException exception)
    {
        return exception.Kind == ApiErrorKind.Unauthorized;
    }

    /// <summary>
    /// Navigates to the login page with a session-expired hint and a safe return URL.
    /// </summary>
    public static void RedirectToLogin(NavigationManager navigation)
    {
        var returnPath = "/" + navigation.ToBaseRelativePath(navigation.Uri);
        var safeReturnUrl = AuthRoutePolicy.ResolveSafeReturnUrl(returnPath);

        navigation.NavigateTo(
            $"/auth/login?error=session_expired&returnUrl={Uri.EscapeDataString(safeReturnUrl)}",
            forceLoad: true);
    }
}
