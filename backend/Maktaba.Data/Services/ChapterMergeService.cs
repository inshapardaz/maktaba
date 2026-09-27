using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class ChapterMergeService(
    MaktabaDbContext db,
    ILibraryService libraryService,
    IDigitizationJsonStore jsonStore) : IChapterMergeService
{
    private async Task<(DigitizationState State, string AbsoluteFolder)> LoadAsync(int bookId, CancellationToken ct)
    {
        var root = libraryService.LibraryRootPath ?? throw new LibraryNotOpenException();
        var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct)
            ?? throw new KeyNotFoundException($"Book {bookId} not found.");
        var absoluteFolder = Path.Combine(root, book.FolderPath);
        var state = await jsonStore.ReadAsync(absoluteFolder, ct)
            ?? throw new InvalidOperationException("This book has no digitization.json - call StartAsync first.");
        return (state, absoluteFolder);
    }

    public async Task<string> MergeChapterAsync(int bookId, string chapterId, CancellationToken ct = default)
    {
        var (state, absoluteFolder) = await LoadAsync(bookId, ct);
        return await MergeChapterAsync(state, absoluteFolder, chapterId, ct);
    }

    public async Task<IReadOnlyDictionary<string, string>> MergeAllChaptersAsync(int bookId, CancellationToken ct = default)
    {
        var (state, absoluteFolder) = await LoadAsync(bookId, ct);
        var result = new Dictionary<string, string>();
        foreach (var chapter in state.Chapters.OrderBy(c => c.Order))
        {
            result[chapter.Id] = await MergeChapterAsync(state, absoluteFolder, chapter.Id, ct);
        }

        return result;
    }

    private static async Task<string> MergeChapterAsync(DigitizationState state, string absoluteFolder, string chapterId, CancellationToken ct)
    {
        var pages = state.Pages.Where(p => p.ChapterId == chapterId).OrderBy(p => p.Order).ToList();
        if (pages.Count == 0)
        {
            return "";
        }

        var parts = new List<string>(pages.Count * 2);
        foreach (var page in pages)
        {
            parts.Add(PageBoundaryMarker.Format(page.Id));

            if (page.Text is not null)
            {
                var textPath = Path.Combine(absoluteFolder, page.Text);
                if (File.Exists(textPath))
                {
                    parts.Add(await File.ReadAllTextAsync(textPath, ct));
                }
            }
        }

        return string.Join("\n\n", parts);
    }
}
