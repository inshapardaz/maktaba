using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
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

    // Per the epic's own amendment ("page number is the filename, not a decoupled order field") -
    // Phase 0/1 already committed to this (DigitizationPaths.PageImagePath derives a page's path
    // from its number, and PdfToImageConversionService names files sequentially at conversion
    // time), so reordering/deleting pages here has to rename files to keep that invariant, not just
    // update an `order` column. (Issue #177's own body text suggested the opposite - "filenames are
    // stable/arbitrary and never renamed" - which would only be true if Phase 0/1 had stored a
    // decoupled order field instead; they didn't, so this follows the epic doc's explicit amendment
    // over that one issue's description. Flagged in the PR for a human to confirm.)
    public async Task ReorderPagesAsync(int bookId, IReadOnlyList<string> pageIdsInOrder, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);

        if (pageIdsInOrder.Count != state.Pages.Count || !pageIdsInOrder.ToHashSet().SetEquals(state.Pages.Select(p => p.Id)))
        {
            throw new ArgumentException("pageIdsInOrder must be a permutation of the book's existing page ids.", nameof(pageIdsInOrder));
        }

        var pagesById = state.Pages.ToDictionary(p => p.Id);
        var newOrder = pageIdsInOrder.Select(id => pagesById[id]).ToList();

        var renumbered = RenumberFiles(absoluteFolder, newOrder);
        await PersistPagesAsync(bookId, absoluteFolder, state, renumbered, ct);
    }

    public async Task BulkSetStatusAsync(int bookId, IReadOnlyList<string> pageIds, PageEditStatus status, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var idSet = pageIds.ToHashSet();

        var updatedPages = state.Pages
            .Select(p => idSet.Contains(p.Id) ? p with { EditStatus = status.ToString() } : p)
            .ToList();

        await PersistPagesAsync(bookId, absoluteFolder, state, updatedPages, ct);
    }

    public async Task BulkSetChapterAsync(int bookId, IReadOnlyList<string> pageIds, string? chapterId, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var idSet = pageIds.ToHashSet();

        if (chapterId is not null && !state.Chapters.Any(c => c.Id == chapterId))
        {
            throw new ArgumentException($"Chapter {chapterId} does not exist.", nameof(chapterId));
        }

        var updatedPages = state.Pages
            .Select(p => idSet.Contains(p.Id) ? p with { ChapterId = chapterId } : p)
            .ToList();

        await PersistPagesAsync(bookId, absoluteFolder, state, updatedPages, ct);
    }

    public async Task DeletePagesAsync(int bookId, IReadOnlyList<string> pageIds, CancellationToken ct = default)
    {
        var (_, absoluteFolder) = await LoadBookAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        var idSet = pageIds.ToHashSet();

        foreach (var page in state.Pages.Where(p => idSet.Contains(p.Id)))
        {
            DeleteFileIfExists(absoluteFolder, page.Image);
            if (page.Text is not null)
            {
                DeleteFileIfExists(absoluteFolder, page.Text);
            }
        }

        var remaining = state.Pages.Where(p => !idSet.Contains(p.Id)).ToList();
        var renumbered = RenumberFiles(absoluteFolder, remaining);
        await PersistPagesAsync(bookId, absoluteFolder, state, renumbered, ct);
    }

    private async Task<DigitizationState> RequireStateAsync(string absoluteFolder, CancellationToken ct) =>
        await jsonStore.ReadAsync(absoluteFolder, ct)
            ?? throw new InvalidOperationException("This book has no digitization.json - call StartAsync first.");

    private async Task PersistPagesAsync(
        int bookId, string absoluteFolder, DigitizationState state, List<DigitizationJsonPage> pages, CancellationToken ct)
    {
        await jsonStore.WriteAsync(absoluteFolder, state with { Pages = pages }, ct);

        // Rebuilds this book's DigitizationPage cache rows from the digitization.json just written -
        // reuses the same rescan pass a manual "Resync" would run (see DigitizationRescanService),
        // rather than duplicating the json-to-DB-row mapping logic here.
        var rescan = new DigitizationRescanService(db, libraryService, jsonStore);
        await rescan.RescanAsync(ct);
    }

    // Renumbers pages[] to 1..N in list order and renames each page's image/text files to match -
    // via a temp-name pass first so overlapping old/new numbers (e.g. swapping two pages) can never
    // collide mid-rename. Returns the pages with their Image/Text/Order fields updated to the new
    // numbering; callers still need to persist the result via PersistPagesAsync.
    private static List<DigitizationJsonPage> RenumberFiles(string absoluteFolder, List<DigitizationJsonPage> pagesInNewOrder)
    {
        var tempPaths = new Dictionary<string, (string? Image, string? Text)>();
        foreach (var page in pagesInNewOrder)
        {
            var tempImage = MoveToTemp(absoluteFolder, page.Image);
            var tempText = page.Text is not null ? MoveToTemp(absoluteFolder, page.Text) : null;
            tempPaths[page.Id] = (tempImage, tempText);
        }

        var result = new List<DigitizationJsonPage>(pagesInNewOrder.Count);
        for (var i = 0; i < pagesInNewOrder.Count; i++)
        {
            var page = pagesInNewOrder[i];
            var pageNumber = i + 1;
            var (tempImage, tempText) = tempPaths[page.Id];

            var finalImage = DigitizationPaths.PageImagePath(pageNumber);
            MoveFromTemp(absoluteFolder, tempImage, finalImage);

            string? finalText = null;
            if (tempText is not null)
            {
                finalText = DigitizationPaths.PageTextPath(pageNumber);
                MoveFromTemp(absoluteFolder, tempText, finalText);
            }

            result.Add(page with { Order = pageNumber, Image = finalImage, Text = finalText });
        }

        return result;
    }

    private static string? MoveToTemp(string absoluteFolder, string? relativePath)
    {
        if (relativePath is null)
        {
            return null;
        }

        var sourcePath = Path.Combine(absoluteFolder, relativePath);
        if (!File.Exists(sourcePath))
        {
            return null;
        }

        var tempRelative = Path.Combine(DigitizationPaths.PagesFolderName, $"__tmp_{Guid.NewGuid():N}{Path.GetExtension(relativePath)}");
        File.Move(sourcePath, Path.Combine(absoluteFolder, tempRelative));
        return tempRelative;
    }

    private static void MoveFromTemp(string absoluteFolder, string? tempRelative, string finalRelative)
    {
        if (tempRelative is null)
        {
            return;
        }

        File.Move(Path.Combine(absoluteFolder, tempRelative), Path.Combine(absoluteFolder, finalRelative), overwrite: true);
    }

    private static void DeleteFileIfExists(string absoluteFolder, string relativePath)
    {
        var path = Path.Combine(absoluteFolder, relativePath);
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    // Phase 5.
    public Task SavePageTextAsync(int bookId, string pageId, string text, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 5 (Typing Editor).");

    // Phase 6.
    public Task<string> RunOcrAsync(int bookId, string pageId, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 6 (OCR via Google Vision).");
}
