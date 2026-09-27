namespace Maktaba.Core.Naming;

/// <summary>
/// Builds the on-disk paths for a digitized book's page images/text, relative to the book's own
/// folder - "pages/{0000}.jpg" / "pages/{0000}.md" (see the epic's "page number is the filename"
/// amendment: reordering pages renames these files to match the new page number, rather than the
/// page number being a decoupled field pointing at an arbitrarily-named file).
/// </summary>
public static class DigitizationPaths
{
    public const string PagesFolderName = "pages";

    public static string PageImagePath(int pageNumber) =>
        Path.Combine(PagesFolderName, $"{pageNumber:D4}.jpg");

    public static string PageTextPath(int pageNumber) =>
        Path.Combine(PagesFolderName, $"{pageNumber:D4}.md");
}
