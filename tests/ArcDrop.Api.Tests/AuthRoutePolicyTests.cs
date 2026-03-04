using ArcDrop.Web.Services;

namespace ArcDrop.Api.Tests;

public sealed class AuthRoutePolicyTests
{
    [Theory]
    [InlineData("auth/login")]
    [InlineData("/auth/login")]
    [InlineData("auth/login?returnUrl=%2Fbookmarks")]
    [InlineData("/auth/login#section")]
    [InlineData("not-found")]
    [InlineData("error")]
    public void IsPublicPath_ReturnsTrue_ForPublicRoutes(string route)
    {
        var result = AuthRoutePolicy.IsPublicPath(route);

        Assert.True(result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("bookmarks")]
    [InlineData("auth/profile")]
    [InlineData("ai/providers")]
    public void IsPublicPath_ReturnsFalse_ForProtectedRoutes(string route)
    {
        var result = AuthRoutePolicy.IsPublicPath(route);

        Assert.False(result);
    }

    [Theory]
    [InlineData(null, "/bookmarks")]
    [InlineData("", "/bookmarks")]
    [InlineData("/auth/login", "/bookmarks")]
    [InlineData("/auth/login?returnUrl=%2Fbookmarks", "/bookmarks")]
    [InlineData("/auth/login#header", "/bookmarks")]
    [InlineData("//evil.example", "/bookmarks")]
    [InlineData("auth/profile", "/bookmarks")]
    [InlineData("/bookmarks", "/bookmarks")]
    [InlineData("/ai/providers", "/ai/providers")]
    public void ResolveSafeReturnUrl_ProtectsAgainstUnsafeTargets(string? candidate, string expected)
    {
        var result = AuthRoutePolicy.ResolveSafeReturnUrl(candidate);

        Assert.Equal(expected, result);
    }
}
