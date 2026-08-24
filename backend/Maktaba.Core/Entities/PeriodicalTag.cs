namespace Maktaba.Core.Entities;

public class PeriodicalTag
{
    public int PeriodicalId { get; set; }
    public Periodical Periodical { get; set; } = null!;

    public int TagId { get; set; }
    public Tag Tag { get; set; } = null!;
}
