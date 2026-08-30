namespace Maktaba.Core.Entities;

public enum PeriodicalFrequency
{
    Daily,
    Weekly,
    BiWeekly,
    Monthly,
    Quarterly,
    Yearly,
    Occasional,
}

public class Periodical
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string SortName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public PeriodicalFrequency Frequency { get; set; } = PeriodicalFrequency.Occasional;

    public DateTime DateAdded { get; set; } = DateTime.UtcNow;

    // Metadata that lives at the periodical level rather than per-issue - an issue's own
    // language/publisher/editor/tags are the periodical's, not something each issue edits
    // separately (see BookEditForm.tsx, which hides those fields once a book is an issue).
    // Issue #30: an issue has no language of its own - the reader falls back to its periodical's
    // language, then to English, to pick a word-lookup dictionary. ISO 639-1 code, same
    // convention as Book.Language.
    public string? Language { get; set; }
    public string? Publisher { get; set; }
    public string? Editor { get; set; }

    /// <summary>Path to this periodical's own folder (holds its cover image), relative to the library root.</summary>
    public string FolderPath { get; set; } = string.Empty;

    public List<Book> Issues { get; set; } = [];
    public List<PeriodicalTag> PeriodicalTags { get; set; } = [];
}
