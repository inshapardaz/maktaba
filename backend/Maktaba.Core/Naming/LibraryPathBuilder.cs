using Maktaba.Core.Ids;

namespace Maktaba.Core.Naming;

/// <summary>
/// The single place that builds a book/periodical's on-disk folder path (relative to the library
/// root), so every service agrees on the same layout - previously duplicated inline in
/// ImportService and PeriodicalService. Behaviour-preserving extraction: produces exactly the same
/// paths those call sites built by hand.
/// </summary>
public static class LibraryPathBuilder
{
    /// <summary>"{first author's sort name}/{title} ({sqid})" - the layout ImportService has always
    /// used. <paramref name="firstAuthorSortName"/> should be null/empty when the book has no
    /// authors, in which case "Unknown Author" is used, matching prior behaviour.</summary>
    public static string BookFolderPath(string? firstAuthorSortName, string title, int bookId)
    {
        var authorSegment = FileNaming.SanitizePathSegment(
            string.IsNullOrEmpty(firstAuthorSortName) ? "Unknown Author" : firstAuthorSortName);
        var bookSegment = FileNaming.SanitizePathSegment($"{title} ({IdCodec.Encode(bookId)})");
        return Path.Combine(authorSegment, bookSegment);
    }

    /// <summary>"Periodicals/{name} ({sqid})" - the layout PeriodicalService has always used.</summary>
    public static string PeriodicalFolderPath(string name, int periodicalId)
    {
        var segment = FileNaming.SanitizePathSegment($"{name} ({IdCodec.Encode(periodicalId)})");
        return Path.Combine("Periodicals", segment);
    }

    /// <summary>"Periodicals/{periodical name} ({sqid})/{issue title} ({sqid})" - a periodical
    /// issue is a Book with PeriodicalId set, filed under its periodical's folder instead of an
    /// author folder. The layout BookFolderRelocator has always used for that case.</summary>
    public static string IssueFolderPath(string periodicalName, int periodicalId, string issueTitle, int issueId)
    {
        var issueSegment = FileNaming.SanitizePathSegment($"{issueTitle} ({IdCodec.Encode(issueId)})");
        return Path.Combine(PeriodicalFolderPath(periodicalName, periodicalId), issueSegment);
    }
}
