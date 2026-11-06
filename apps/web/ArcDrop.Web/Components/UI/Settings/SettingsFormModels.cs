namespace ArcDrop.Web.Components.UI.Settings;

/// <summary>
/// Carries collection toggle intent from Settings data section UI.
/// </summary>
public readonly record struct ExportCollectionToggleEventArgs(Guid CollectionId, bool IsChecked);
