namespace ArcDrop.Web.Services;

public interface ISharedStateService
{
    event Action OnBookmarksUpdated;
    event Action OnCollectionsUpdated;

    void NotifyBookmarksUpdated();
    void NotifyCollectionsUpdated();
}

public class SharedStateService : ISharedStateService
{
    public event Action? OnBookmarksUpdated;
    public event Action? OnCollectionsUpdated;

    public void NotifyBookmarksUpdated()
    {
        OnBookmarksUpdated?.Invoke();
    }

    public void NotifyCollectionsUpdated()
    {
        OnCollectionsUpdated?.Invoke();
    }
}
