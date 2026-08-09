namespace Maktaba.Core.Services;

public enum ImportDuplicateResolution
{
    /// <summary>Detect duplicates and throw <see cref="DuplicateBookDetectedException"/> if one is found.</summary>
    Auto,

    /// <summary>A duplicate was found and the caller wants to leave the existing book untouched.</summary>
    Skip,

    /// <summary>Import as a brand-new, separate book regardless of any match.</summary>
    KeepBoth,

    /// <summary>Add this file to the existing matched book instead of creating a new one.</summary>
    Merge,
}

/// <summary>
/// Thrown by <see cref="IImportService.ImportFileAsync"/> when <see cref="ImportDuplicateResolution.Auto"/>
/// finds a likely-duplicate book, so the caller can ask the user how to proceed.
/// </summary>
public class DuplicateBookDetectedException(
    int existingBookId, string existingTitle, IReadOnlyList<string> existingAuthors, bool sameContentHash)
    : Exception($"A matching book already exists: \"{existingTitle}\".")
{
    public int ExistingBookId { get; } = existingBookId;
    public string ExistingTitle { get; } = existingTitle;
    public IReadOnlyList<string> ExistingAuthors { get; } = existingAuthors;

    /// <summary>True if the exact file content already exists (byte-identical); false if it's a title/author match.</summary>
    public bool SameContentHash { get; } = sameContentHash;
}
