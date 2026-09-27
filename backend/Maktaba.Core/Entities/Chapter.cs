namespace Maktaba.Core.Entities;

// A digitization chapter grouping this book's DigitizationPage rows - unrelated to the plain
// string "chapter id" used elsewhere (Bookmark.ChapterId/Note.ChapterId/ReadingProgress.ChapterId),
// which identifies a location within an already-published EPUB's own table of contents, not a row
// in this table. Rebuilt from digitization.json on every digitization rescan (see
// DigitizationRescanService) - digitization.json is the source of truth, this row is a cache, same
// relationship Book/metadata.db has to the on-disk book folder layout.
public class Chapter
{
    public int Id { get; set; }
    public int BookId { get; set; }
    public Book? Book { get; set; }

    // Stable across a rescan even though the underlying digitization.json chapter id ("c1", "c2",
    // ...) is a plain string - DigitizationRescanService maps json chapter ids to Chapter.Id the
    // same way it maps json page ids to DigitizationPage.Id (see that class's own comment).
    public string JsonChapterId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public int Order { get; set; }

    // The page that starts this chapter - drives the "first page of chapter, autofill the rest"
    // shortcut (Phase 4). Null is valid (a chapter can exist with no pages assigned yet).
    public int? FirstPageId { get; set; }
    public DigitizationPage? FirstPage { get; set; }

    public List<DigitizationPage> Pages { get; set; } = [];
}
