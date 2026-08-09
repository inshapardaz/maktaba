namespace Maktaba.Core.Entities;

public class BookSeries
{
    public Guid BookId { get; set; }
    public Book Book { get; set; } = null!;

    public Guid SeriesId { get; set; }
    public Series Series { get; set; } = null!;

    public double SeriesIndex { get; set; }
}
