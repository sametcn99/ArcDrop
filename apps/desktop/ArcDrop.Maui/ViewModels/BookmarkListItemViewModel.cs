using ArcDrop.Application.Bookmarks;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// View model projection for one bookmark card row in list workflows.
/// </summary>
public sealed class BookmarkListItemViewModel
{
    public BookmarkListItemViewModel(BookmarkListItem model)
    {
        Id = model.Id;
        Url = model.Url;
        Title = model.Title;
        Summary = model.Summary;
        UpdatedAtText = model.UpdatedAtUtc.ToLocalTime().ToString("g");
    }

    public Guid Id { get; }

    public string Url { get; }

    public string Title { get; }

    public string? Summary { get; }

    public string UpdatedAtText { get; }
}
