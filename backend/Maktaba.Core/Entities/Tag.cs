namespace Maktaba.Core.Entities;

public class Tag
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public List<BookTag> BookTags { get; set; } = [];
}
