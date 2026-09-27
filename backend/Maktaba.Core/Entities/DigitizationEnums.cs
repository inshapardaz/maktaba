namespace Maktaba.Core.Entities;

// Per-page progress through typing/OCR/proofreading - see PageEditStatus's usage on
// DigitizationPage.EditStatus and BookDigitizationStatus's own doc comment for how the two relate.
public enum PageEditStatus
{
    Pending,
    Typing,
    Typed,
    ProofRead,
    Complete,
}

// A book's digitization progress, distinct from ReadingStatus (that one tracks the *reader's*
// progress through an already-published book; this one tracks the *digitizer's* progress toward
// producing one). Only meaningful once a book has digitization.json (see DigitizationJsonStore) -
// a book that's never been digitized has no BookDigitizationStatus at all, not a Pending one.
//
// Typing/Typed/ProofRead are rolled up from the aggregate of this book's DigitizationPage.EditStatus
// values (see DigitizationRescanService) rather than set directly - ChaptersReady/ChapterProofRead/
// Published are set by their own actions (chapter assignment completing, the merge step, publishing)
// in later phases, not inferred from page state.
public enum BookDigitizationStatus
{
    Pending,
    Typing,
    Typed,
    ProofRead,
    ChaptersReady,
    ChapterProofRead,
    Published,
}
