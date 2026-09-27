using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class DigitizationService(
    MaktabaDbContext db,
    ILibraryService libraryService,
    IDigitizationJsonStore jsonStore) : IDigitizationService
{
    private async Task<(Book Book, string AbsoluteFolder)> LoadBookAsync(int bookId, CancellationToken ct)
    {
        var root = libraryService.LibraryRootPath ?? throw new LibraryNotOpenException();
        var book = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == bookId, ct)
            ?? throw new KeyNotFoundException($"Book {bookId} not found.");
        return (book, Path.Combine(root, book.FolderPath));
    }

    public async Task<DigitizationState> StartAsync(int bookId, bool isRightToLeft, CancellationToken ct = default)
    {
        var (book, absoluteFolder) = await LoadBookAsync(bookId, ct);

        // Idempotent re-start: an already-digitized book's existing digitization.json (and its own
        // IsRightToLeft, possibly already corrected by the user) is returned untouched rather than
        // reset - see this method's own doc comment.
        var existing = await jsonStore.ReadAsync(absoluteFolder, ct);
        if (existing is not null)
        {
            return existing;
        }

        var sourcePdf = book.Files.FirstOrDefault(f => f.Format == BookFormat.Pdf)
            ?? throw new InvalidOperationException($"Book {bookId} has no PDF file to digitize.");

        var state = new DigitizationState(
            Version: DigitizationState.CurrentVersion,
            SourcePdf: Path.GetFileName(sourcePdf.FilePath),
            IsRightToLeft: isRightToLeft,
            Status: nameof(BookDigitizationStatus.Pending),
            Pages: [],
            Chapters: []);

        await jsonStore.WriteAsync(absoluteFolder, state, ct);

        book.DigitizationStatus = BookDigitizationStatus.Pending;
        await db.SaveChangesAsync(ct);

        return state;
    }

    public async Task<DigitizationState?> GetStateAsync(int bookId, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        return await jsonStore.ReadAsync(absoluteFolder, ct);
    }

    // Phase 2.
    public Task ReorderPagesAsync(int bookId, IReadOnlyList<string> pageIdsInOrder, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 2 (Page Management UI).");

    // Phase 2.
    public Task BulkSetStatusAsync(int bookId, IReadOnlyList<string> pageIds, PageEditStatus status, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 2 (Page Management UI).");

    // Phase 2/4.
    public Task BulkSetChapterAsync(int bookId, IReadOnlyList<string> pageIds, string? chapterId, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 2/4 (Page Management UI / Chapters).");

    // Phase 2.
    public Task DeletePagesAsync(int bookId, IReadOnlyList<string> pageIds, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 2 (Page Management UI).");

    // Phase 5.
    public Task SavePageTextAsync(int bookId, string pageId, string text, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 5 (Typing Editor).");

    // Phase 6.
    public Task<string> RunOcrAsync(int bookId, string pageId, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 6 (OCR via Google Vision).");
}
