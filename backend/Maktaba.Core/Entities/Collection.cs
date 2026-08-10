namespace Maktaba.Core.Entities;

public class Collection
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public List<BookCollection> BookCollections { get; set; } = [];
}
