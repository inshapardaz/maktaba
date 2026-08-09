namespace Maktaba.Core.Naming;

/// <summary>Calibre-style sort-key helpers: "The Hobbit" -> "Hobbit, The", "J.R.R. Tolkien" -> "Tolkien, J.R.R.".</summary>
public static class TitleSorting
{
    private static readonly string[] LeadingArticles = ["A", "An", "The"];

    public static string ComputeSortTitle(string title)
    {
        var trimmed = title.Trim();

        foreach (var article in LeadingArticles)
        {
            var prefix = article + " ";
            if (trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return $"{trimmed[prefix.Length..]}, {trimmed[..article.Length]}";
            }
        }

        return trimmed;
    }

    public static string ComputeAuthorSortName(string name)
    {
        var trimmed = name.Trim();
        var lastSpace = trimmed.LastIndexOf(' ');
        if (lastSpace <= 0)
        {
            return trimmed;
        }

        var firstNames = trimmed[..lastSpace];
        var lastName = trimmed[(lastSpace + 1)..];
        return $"{lastName}, {firstNames}";
    }
}
