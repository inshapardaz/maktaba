using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class BookConversionService(
    MaktabaDbContext db, IStorageProviderFactory storageFactory, ICalibreConverter converter) : IBookConversionService
{
    private IStorageProvider Storage => storageFactory.Current;

    public bool IsAvailable => converter.IsAvailable;

    public async Task<BookConversionResult> ConvertAsync(int bookId, BookFormat targetFormat, CancellationToken ct = default)
    {
        var book = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return new BookConversionResult(BookConversionOutcome.BookNotFound);
        }

        if (book.Files.Any(f => f.Format == targetFormat))
        {
            return new BookConversionResult(BookConversionOutcome.AlreadyHasFormat);
        }

        if (!converter.IsAvailable)
        {
            return new BookConversionResult(BookConversionOutcome.CalibreUnavailable);
        }

        var folderAbsolute = await Storage.GetLocalPathAsync(book.FolderPath, ct);

        // Any existing file works as a source - Calibre reads whatever format it is and produces the
        // target format, so it doesn't matter which of the book's current files gets picked.
        var sourceFile = book.Files[0];
        var sourceAbsolute = await Storage.GetLocalPathAsync(sourceFile.FilePath, ct);

        var targetExtension = targetFormat switch
        {
            BookFormat.Epub => ".epub",
            BookFormat.Pdf => ".pdf",
            BookFormat.Docx => ".docx",
            BookFormat.Txt => ".txt",
            _ => throw new NotSupportedException($"Unsupported target format: {targetFormat}"),
        };

        var destFileName = FileNaming.SanitizePathSegment(book.Title) + targetExtension;
        var destAbsolute = EbookFileHelpers.GetUniqueFilePath(folderAbsolute, destFileName);

        await converter.ConvertAsync(sourceAbsolute, destAbsolute, ct);

        var destRelative = Path.Combine(book.FolderPath, Path.GetFileName(destAbsolute));
        await Storage.NotifyWrittenAsync(destRelative, ct);

        var contentHash = await EbookFileHelpers.ComputeSha256Async(destAbsolute, ct);
        var bookFile = new BookFile
        {
            BookId = book.Id,
            Format = targetFormat,
            FilePath = destRelative,
            FileSizeBytes = new FileInfo(destAbsolute).Length,
            ContentHash = contentHash,
        };

        db.BookFiles.Add(bookFile);
        await db.SaveChangesAsync(ct);

        return new BookConversionResult(BookConversionOutcome.Converted, bookFile);
    }
}
