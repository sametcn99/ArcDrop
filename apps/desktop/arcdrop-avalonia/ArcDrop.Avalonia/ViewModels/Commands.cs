using System.Windows.Input;

namespace ArcDrop.Avalonia.ViewModels;

/// <summary>
/// Minimal ICommand implementation matching the desktop MVVM conventions.
/// Avalonia does not provide a CommandManager, so CanExecuteChanged is raise-on-demand only.
/// </summary>
public sealed class Command : ICommand
{
    private readonly Action _execute;
    private readonly Func<bool>? _canExecute;

    public Command(Action execute, Func<bool>? canExecute = null)
    {
        _execute = execute;
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => _canExecute?.Invoke() ?? true;

    public void Execute(object? parameter) => _execute();

    /// <summary>
    /// Notifies bound controls that the executable state changed.
    /// </summary>
    public void RaiseCanExecuteChanged()
    {
        CanExecuteChanged?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// Parameterized ICommand variant for row-level actions such as edit and delete.
/// </summary>
public sealed class Command<T> : ICommand
{
    private readonly Action<T?> _execute;
    private readonly Func<T?, bool>? _canExecute;

    public Command(Action<T?> execute, Func<T?, bool>? canExecute = null)
    {
        _execute = execute;
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => _canExecute?.Invoke(Translate(parameter)) ?? true;

    public void Execute(object? parameter) => _execute(Translate(parameter));

    /// <summary>
    /// Notifies bound controls that the executable state changed.
    /// </summary>
    public void RaiseCanExecuteChanged()
    {
        CanExecuteChanged?.Invoke(this, EventArgs.Empty);
    }

    private static T? Translate(object? parameter) => parameter is T typed ? typed : default;
}
