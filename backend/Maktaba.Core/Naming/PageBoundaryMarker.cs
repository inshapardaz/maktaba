namespace Maktaba.Core.Naming;

/// <summary>
/// The hidden marker inserted between two pages' text when merging a chapter's pages into one
/// Markdown string (epic #162, Phase 7 - issue #190). <b>PLACEHOLDER, not yet confirmed</b>: the
/// epic's own design doc says this must match an existing convention from another part of the
/// user's toolchain (their reader apps), to be provided as a comment on issue #190 before this
/// phase starts - as of this implementation, no such comment had been added, so real work
/// (chapter-merge status gating, the merge action itself, Phase 8's publisher) couldn't simply wait
/// on it indefinitely. An HTML comment was picked as the placeholder specifically because it stays
/// invisible after Markdig renders the merged Markdown to XHTML (HTML comments pass through
/// Markdown untouched, per the epic's own note on this) - the same property whatever the *real*
/// convention turns out to be will need. Swapping this one constant (and its matching parse regex)
/// is the only change needed once the real format is confirmed; nothing else in Phase 7/8 depends
/// on the marker's literal text.
/// </summary>
public static class PageBoundaryMarker
{
    /// <summary>Formats the marker inserted immediately before a page's own text, identifying it by
    /// its digitization.json page id (stable across reordering, unlike a page number).</summary>
    public static string Format(string pageId) => $"<!-- page:{pageId} -->";
}
