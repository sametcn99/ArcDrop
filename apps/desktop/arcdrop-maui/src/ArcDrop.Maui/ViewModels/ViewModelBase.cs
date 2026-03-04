using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace ArcDrop.Maui.ViewModels;

/// <summary>
/// Provides minimal and explicit property change notification for MVVM view models.
/// This base class avoids framework lock-in while keeping view binding updates deterministic.
/// </summary>
public abstract class ViewModelBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Sets a backing field and notifies bindings only when the value actually changed.
    /// The equality guard prevents unnecessary UI refreshes on repeated assignments.
    /// </summary>
    protected bool SetProperty<T>(ref T backingField, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(backingField, value))
        {
            return false;
        }

        backingField = value;
        OnPropertyChanged(propertyName);
        return true;
    }

    /// <summary>
    /// Raises property changed notifications for data-bound UI elements.
    /// </summary>
    protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
