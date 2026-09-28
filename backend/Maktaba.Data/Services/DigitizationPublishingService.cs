using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Maktaba.Publishing;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class DigitizationPublishingService(
    MaktabaDbContext db,
    ILibraryService libraryService,
    IDigitizationJsonStore jsonStore,
    IChapterMergeService mergeService,
    IEnumerable<IBookPublisher> publishers) : IDigitizationPublishingService
{
    public async Task<BookFile> PublishAsync(int bookId, string format, CancellationToken ct = default)
    {
        if (!Enum.TryParse<PublishFormat>(format, ignoreCase: true, out var publishFormat))
        {
            throw new ArgumentException($"Unknown publish format '{format}'.", nameof(format));
        }

        var publisher = publishers.FirstOrDefault(p => p.Format == publishFormat)
            ?? throw new InvalidOperationException($"No publisher registered for '{format}'.");

        var root = libraryService.LibraryRootPath ?? throw new LibraryNotOpenException();
        var book = await db.Books
            .Include(b => b.Files)
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
            .FirstOrDefaultAsync(b => b.Id == bookId, ct)
            ?? throw new KeyNotFoundException($"Book {bookId} not found.");

        var absoluteFolder = Path.Combine(root, book.FolderPath);
        var state = await jsonStore.ReadAsync(absoluteFolder, ct)
            ?? throw new InvalidOperationException("This book has no digitization.json - call StartAsync first.");

        var mergedByChapter = await mergeService.MergeAllChaptersAsync(bookId, ct);
        var chapters = state.Chapters
            .OrderBy(c => c.Order)
            .Select(c => new PublishChapter(c.Title, mergedByChapter.GetValueOrDefault(c.Id, "")))
            .ToList();

        byte[]? coverBytes = null;
        var cover = CoverLocator.Find(root, book.FolderPath);
        if (cover is { } found && File.Exists(found.FilePath))
        {
            coverBytes = await File.ReadAllBytesAsync(found.FilePath, ct);
        }

        var series = book.BookSeries.FirstOrDefault();
        var input = new PublishInput(
            Title: book.Title,
            Language: book.Language,
            Authors: book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToList(),
            Publisher: book.Publisher,
            SeriesName: series?.Series.Name,
            SeriesIndex: series?.SeriesIndex,
            Chapters: chapters,
            CoverImageBytes: coverBytes);

        var bytes = publisher.Generate(input);

        // "{Title} (published).{ext}" - deliberately distinct from the source file's own name
        // (e.g. "{Title}.pdf") so publishing a PDF can never overwrite the source PDF this book was
        // digitized from.
        var fileName = FileNaming.SanitizePathSegment($"{book.Title} (published)") + "." + publisher.FileExtension;
        var relativePath = Path.Combine(book.FolderPath, fileName);
        var absolutePath = Path.Combine(root, relativePath);
        await File.WriteAllBytesAsync(absolutePath, bytes, ct);
        var hash = await EbookFileHelpers.ComputeSha256Async(absolutePath, ct);

        var bookFormat = publishFormat switch
        {
            PublishFormat.Epub => BookFormat.Epub,
            PublishFormat.Markdown => BookFormat.Markdown,
            PublishFormat.Pdf => BookFormat.Pdf,
            _ => throw new NotSupportedException(publishFormat.ToString()),
        };

        // Matched by its own relative path (not a separate "publishedFiles" map in
        // digitization.json) - a repeat publish for this format always lands at the same path, so
        // finding the existing row this way is enough to update it in place instead of duplicating.
        var bookFile = book.Files.FirstOrDefault(f => f.FilePath == relativePath);
        if (bookFile is not null)
        {
            bookFile.FileSizeBytes = bytes.LongLength;
            bookFile.ContentHash = hash;
        }
        else
        {
            bookFile = new BookFile
            {
                BookId = bookId,
                Format = bookFormat,
                FilePath = relativePath,
                FileSizeBytes = bytes.LongLength,
                ContentHash = hash,
            };
            db.BookFiles.Add(bookFile);
        }

        book.DigitizationStatus = BookDigitizationStatus.Published;
        await db.SaveChangesAsync(ct);

        await jsonStore.WriteAsync(absoluteFolder, state with { Status = nameof(BookDigitizationStatus.Published) }, ct);

        return bookFile;
    }
}
