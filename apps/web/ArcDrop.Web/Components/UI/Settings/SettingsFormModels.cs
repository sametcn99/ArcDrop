using System.ComponentModel.DataAnnotations;

namespace ArcDrop.Web.Components.UI.Settings;

/// <summary>
/// Represents mutable form state for AI provider create/update operations in Settings.
/// </summary>
public sealed class ProviderFormState
{
    [Required]
    public string ProviderName { get; set; } = string.Empty;

    [Required]
    [Url]
    public string ApiEndpoint { get; set; } = string.Empty;

    [Required]
    public string Model { get; set; } = string.Empty;

    public string ApiKey { get; set; } = string.Empty;
}

/// <summary>
/// Represents lookup form input for querying an AI operation by identifier.
/// </summary>
public sealed class OperationLookupFormModel
{
    [Required]
    public string OperationId { get; set; } = string.Empty;
}

/// <summary>
/// Carries collection toggle intent from Settings data section UI.
/// </summary>
public readonly record struct ExportCollectionToggleEventArgs(Guid CollectionId, bool IsChecked);
