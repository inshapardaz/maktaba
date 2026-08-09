namespace Maktaba.Core.Entities;

public class Author
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string SortName { get; set; } = string.Empty;

    public List<BookAuthor> BookAuthors { get; set; } = [];
}
