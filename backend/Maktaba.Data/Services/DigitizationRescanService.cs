using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class DigitizationRescanService(
    MaktabaDbContext db,
    ILibraryService libraryService,
    IDigitizationJsonStore jsonStore) : IDigitizationRescanService
{
    public async Task<int> RescanAsync(CancellationToken ct = default)
    {
        var root = libraryService.LibraryRootPath
            ?? throw new LibraryNotOpenException();

        var books = await db.Books.Select(b => new { b.Id, b.FolderPath }).ToListAsync(ct);
        var rebuiltCount = 0;

        foreach (var book in books)
        {
            ct.ThrowIfCancellationRequested();

            var absoluteFolder = Path.Combine(root, book.FolderPath);
            var state = await jsonStore.ReadAsync(absoluteFolder, ct);

            // Children before parent, same FK-satisfying order LibraryRescanService's own wipe uses.
            await db.DigitizationPages.Where(p => p.BookId == book.Id).ExecuteDeleteAsync(ct);
            await db.Chapters.Where(c => c.BookId == book.Id).ExecuteDeleteAsync(ct);

            if (state is null)
            {
                // No digitization.json (never digitized, or it was removed) - the book keeps no
                // digitization rows and a null status, per the epic's zero-impact requirement.
                await db.Books.Where(b => b.Id == book.Id)
                    .ExecuteUpdateAsync(s => s.SetProperty(b => b.DigitizationStatus, (BookDigitizationStatus?)null), ct);
                continue;
            }

            var chaptersByJsonId = new Dictionary<string, Chapter>();
            foreach (var jsonChapter in state.Chapters)
            {
                var chapter = new Chapter
                {
                    BookId = book.Id,
                    JsonChapterId = jsonChapter.Id,
                    Title = jsonChapter.Title,
                    Order = jsonChapter.Order,
                };
                db.Chapters.Add(chapter);
                chaptersByJsonId[jsonChapter.Id] = chapter;
            }

            // Flushed before the pages loop below so each chapter's own Id is assigned and
            // available for DigitizationPage.ChapterId / Chapter.FirstPageId to reference.
            await db.SaveChangesAsync(ct);

            var pagesByJsonId = new Dictionary<string, DigitizationPage>();
            foreach (var jsonPage in state.Pages)
            {
                var chapter = jsonPage.ChapterId is { } chapterId && chaptersByJsonId.TryGetValue(chapterId, out var c) ? c : null;

                string? text = null;
                if (jsonPage.Text is not null)
                {
                    var textPath = Path.Combine(absoluteFolder, jsonPage.Text);
                    if (File.Exists(textPath))
                    {
                        text = await File.ReadAllTextAsync(textPath, ct);
                    }
                }

                var page = new DigitizationPage
                {
                    BookId = book.Id,
                    JsonPageId = jsonPage.Id,
                    Order = jsonPage.Order,
                    ImagePath = jsonPage.Image,
                    TextPath = jsonPage.Text,
                    Text = text,
                    EditStatus = Enum.TryParse<PageEditStatus>(jsonPage.EditStatus, out var editStatus) ? editStatus : PageEditStatus.Pending,
                    Chapter = chapter,
                    SourcePdfPage = jsonPage.SourcePdfPage,
                    SourceSpreadSide = jsonPage.SourceSpreadSide,
                    Rotation = jsonPage.Rotation,
                };
                db.DigitizationPages.Add(page);
                pagesByJsonId[jsonPage.Id] = page;
            }

            await db.SaveChangesAsync(ct);

            foreach (var jsonChapter in state.Chapters)
            {
                if (jsonChapter.FirstPageId is { } firstPageId && pagesByJsonId.TryGetValue(firstPageId, out var firstPage))
                {
                    chaptersByJsonId[jsonChapter.Id].FirstPageId = firstPage.Id;
                }
            }

            var status = Enum.TryParse<BookDigitizationStatus>(state.Status, out var parsedStatus)
                ? parsedStatus
                : BookDigitizationStatus.Pending;
            await db.Books.Where(b => b.Id == book.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(b => b.DigitizationStatus, status), ct);

            await db.SaveChangesAsync(ct);
            rebuiltCount++;
        }

        return rebuiltCount;
    }
}
