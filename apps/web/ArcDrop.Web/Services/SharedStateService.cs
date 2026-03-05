namespace ArcDrop.Web.Services;

public interface ISharedStateService
{
    event Action OnBookmarksUpdated;
    void NotifyBookmarksUpdated();
}

public class SharedStateService : ISharedStateService
{
    public event Action? OnBookmarksUpdated;

    public void NotifyBookmarksUpdated()
    {
        OnBookmarksUpdated?.Invoke();
    }
}
