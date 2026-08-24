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

    /// <summary>Path to this periodical's own folder (holds its cover image), relative to the library root.</summary>
    public string FolderPath { get; set; } = string.Empty;

    public List<Book> Issues { get; set; } = [];
}
