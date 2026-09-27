using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class ChapterService(
    MaktabaDbContext db,
    ILibraryService libraryService,
    IDigitizationJsonStore jsonStore) : IChapterService
{
    private async Task<string> AbsoluteFolderAsync(int bookId, CancellationToken ct)
    {
        var root = libraryService.LibraryRootPath ?? throw new LibraryNotOpenException();
        var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct)
            ?? throw new KeyNotFoundException($"Book {bookId} not found.");
        return Path.Combine(root, book.FolderPath);
    }

    private async Task<DigitizationState> RequireStateAsync(string absoluteFolder, CancellationToken ct) =>
        await jsonStore.ReadAsync(absoluteFolder, ct)
            ?? throw new InvalidOperationException("This book has no digitization.json - call StartAsync first.");

    private async Task<DigitizationState> PersistAsync(int bookId, string absoluteFolder, DigitizationState state, CancellationToken ct)
    {
        await jsonStore.WriteAsync(absoluteFolder, state, ct);

        // Rebuilds this book's Chapter/DigitizationPage cache rows from the digitization.json just
        // written - reuses the rescan pass a manual "Resync" would run, same pattern
        // DigitizationService.PersistPagesAsync already uses.
        var rescan = new DigitizationRescanService(db, libraryService, jsonStore);
        await rescan.RescanAsync(ct);

        return state;
    }

    public async Task<DigitizationState> CreateAsync(int bookId, string title, CancellationToken ct = default)
    {
        var absoluteFolder = await AbsoluteFolderAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);

        var nextOrder = state.Chapters.Count == 0 ? 1 : state.Chapters.Max(c => c.Order) + 1;
        var chapter = new DigitizationJsonChapter(Id: $"c{Guid.NewGuid():N}", Title: title, Order: nextOrder, FirstPageId: null);

        var updated = state with { Chapters = [..state.Chapters, chapter] };
        return await PersistAsync(bookId, absoluteFolder, updated, ct);
    }

    public async Task<DigitizationState> RenameAsync(int bookId, string chapterId, string title, CancellationToken ct = default)
    {
        var absoluteFolder = await AbsoluteFolderAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        RequireChapter(state, chapterId);

        var updated = state with
        {
            Chapters = state.Chapters.Select(c => c.Id == chapterId ? c with { Title = title } : c).ToList(),
        };
        return await PersistAsync(bookId, absoluteFolder, updated, ct);
    }

    public async Task<DigitizationState> ReorderAsync(int bookId, IReadOnlyList<string> chapterIdsInOrder, CancellationToken ct = default)
    {
        var absoluteFolder = await AbsoluteFolderAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);

        if (chapterIdsInOrder.Count != state.Chapters.Count || !chapterIdsInOrder.ToHashSet().SetEquals(state.Chapters.Select(c => c.Id)))
        {
            throw new ArgumentException("chapterIdsInOrder must be a permutation of the book's existing chapter ids.", nameof(chapterIdsInOrder));
        }

        var byId = state.Chapters.ToDictionary(c => c.Id);
        var reordered = chapterIdsInOrder.Select((id, i) => byId[id] with { Order = i + 1 }).ToList();

        var updated = state with { Chapters = reordered };
        return await PersistAsync(bookId, absoluteFolder, updated, ct);
    }

    public async Task<DigitizationState> DeleteAsync(int bookId, string chapterId, CancellationToken ct = default)
    {
        var absoluteFolder = await AbsoluteFolderAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        RequireChapter(state, chapterId);

        var updated = state with
        {
            Chapters = state.Chapters.Where(c => c.Id != chapterId).ToList(),
            Pages = state.Pages.Select(p => p.ChapterId == chapterId ? p with { ChapterId = null } : p).ToList(),
        };
        return await PersistAsync(bookId, absoluteFolder, updated, ct);
    }

    public async Task<DigitizationState> SetFirstPageAsync(int bookId, string chapterId, string pageId, CancellationToken ct = default)
    {
        var absoluteFolder = await AbsoluteFolderAsync(bookId, ct);
        var state = await RequireStateAsync(absoluteFolder, ct);
        RequireChapter(state, chapterId);

        var orderedPages = state.Pages.OrderBy(p => p.Order).ToList();
        var startIndex = orderedPages.FindIndex(p => p.Id == pageId);
        if (startIndex < 0)
        {
            throw new KeyNotFoundException($"Page {pageId} not found.");
        }

        // Every OTHER chapter's own first page (if set) marks where this autofill has to stop -
        // the nearest one after startIndex, by page order, bounds the run; a chapter with no first
        // page yet can't be a boundary.
        var otherFirstPageOrders = state.Chapters
            .Where(c => c.Id != chapterId && c.FirstPageId is not null)
            .Select(c => orderedPages.FirstOrDefault(p => p.Id == c.FirstPageId)?.Order)
            .Where(order => order is not null && order > orderedPages[startIndex].Order)
            .Select(order => order!.Value)
            .ToList();
        var stopBeforeOrder = otherFirstPageOrders.Count > 0 ? otherFirstPageOrders.Min() : (int?)null;

        var updatedPages = state.Pages.Select(p =>
        {
            var order = p.Order;
            var inRange = order >= orderedPages[startIndex].Order && (stopBeforeOrder is null || order < stopBeforeOrder);
            return inRange ? p with { ChapterId = chapterId } : p;
        }).ToList();

        var updatedChapters = state.Chapters.Select(c => c.Id == chapterId ? c with { FirstPageId = pageId } : c).ToList();

        var updated = state with { Pages = updatedPages, Chapters = updatedChapters };
        return await PersistAsync(bookId, absoluteFolder, updated, ct);
    }

    private static void RequireChapter(DigitizationState state, string chapterId)
    {
        if (!state.Chapters.Any(c => c.Id == chapterId))
        {
            throw new KeyNotFoundException($"Chapter {chapterId} not found.");
        }
    }
}
