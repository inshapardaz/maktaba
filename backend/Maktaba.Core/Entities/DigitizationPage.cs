namespace Maktaba.Core.Entities;

// One scanned page of a book being digitized. Rebuilt from digitization.json on every digitization
// rescan (see DigitizationRescanService) - digitization.json and the pages/ folder are the source
// of truth (per the epic's design doc), this row (and its cached Text column) is a rebuildable
// index used for fast listing/filtering/joins with Book, same relationship metadata.db has to the
// library's on-disk book folder layout.
public class DigitizationPage
{
    public int Id { get; set; }
    public int BookId { get; set; }
    public Book? Book { get; set; }

    // Stable identity for this page independent of its current position - digitization.json's own
    // page id ("p1", "p2", ...). Reordering pages renames the underlying image/text files to match
    // the new page number (see epic amendments), but this id and the DB row it identifies never
    // change, the same way a Book's IdCodec-encoded id survives a rescan even though its folder can
    // move.
    public string JsonPageId { get; set; } = string.Empty;
    public int Order { get; set; }

    // Relative to the book's own folder, e.g. "pages/0001.jpg" / "pages/0001.md" - always derived
    // from the current page number at write time (DigitizationJsonStore), never a free-form path.
    public string ImagePath { get; set; } = string.Empty;
    public string? TextPath { get; set; }

    // Cached copy of the page's own Markdown text file contents, for search/listing without a
    // per-page file read - the .md file next to the image remains the actual source of truth (see
    // DigitizationRescanService, which re-reads it from disk on every rescan).
    public string? Text { get; set; }

    public PageEditStatus EditStatus { get; set; } = PageEditStatus.Pending;

    public int? ChapterId { get; set; }
    public Chapter? Chapter { get; set; }

    // Which page of the original source PDF this came from, and which half of a two-page spread
    // (null if the source page wasn't a spread) - Phase 1's rasterize/split step sets these; kept
    // here (not just in digitization.json) since they're useful to query/display without re-parsing
    // the json (e.g. "jump to source PDF page").
    public int? SourcePdfPage { get; set; }
    public string? SourceSpreadSide { get; set; }

    public int Rotation { get; set; }
}
