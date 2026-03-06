namespace ArcDrop.Api.Tests;

/// <summary>
/// Temporarily applies process-level environment variables for an isolated test scope.
/// The helper restores previous values during disposal so parallel or subsequent tests do not inherit mutated configuration state.
/// </summary>
internal sealed class TestEnvironmentVariableScope : IDisposable
{
    private readonly Dictionary<string, string?> _originalValues = new(StringComparer.OrdinalIgnoreCase);

    public TestEnvironmentVariableScope(IReadOnlyDictionary<string, string?> variables)
    {
        foreach (var variable in variables)
        {
            _originalValues[variable.Key] = Environment.GetEnvironmentVariable(variable.Key);
            Environment.SetEnvironmentVariable(variable.Key, variable.Value);
        }
    }

    public void Dispose()
    {
        foreach (var originalValue in _originalValues)
        {
            Environment.SetEnvironmentVariable(originalValue.Key, originalValue.Value);
        }
    }
}