namespace Maktaba.Core.Entities;

public class Author
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string SortName { get; set; } = string.Empty;

    public List<BookAuthor> BookAuthors { get; set; } = [];
}
