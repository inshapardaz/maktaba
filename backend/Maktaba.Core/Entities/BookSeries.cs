namespace Maktaba.Core.Entities;

public class BookSeries
{
    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    public int SeriesId { get; set; }
    public Series Series { get; set; } = null!;

    public double SeriesIndex { get; set; }
}
