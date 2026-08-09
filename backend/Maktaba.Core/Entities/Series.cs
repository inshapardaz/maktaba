namespace Maktaba.Core.Entities;

public class Series
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;

    public List<BookSeries> BookSeries { get; set; } = [];
}
