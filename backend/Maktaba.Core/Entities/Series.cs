namespace Maktaba.Core.Entities;

public class Series
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public List<BookSeries> BookSeries { get; set; } = [];
}
