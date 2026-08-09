namespace Maktaba.Core.Entities;

public class Tag
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;

    public List<BookTag> BookTags { get; set; } = [];
}
