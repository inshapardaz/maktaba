using System.Security.Cryptography;
using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class ImportService(
    MaktabaDbContext db,
    ILibraryPathProvider libraryPath,
    IEnumerable<IBookMetadataExtractor> extractors) : IImportService
{
    public async Task<Book> ImportFileAsync(string sourceFilePath, CancellationToken ct = default)
    {
        // MaktabaDbContext (a constructor dependency) already requires an open library to have been
        // constructed, so LibraryRootPath is guaranteed non-null by the time this method runs.
        var libraryRoot = libraryPath.LibraryRootPath!;

        var extractor = extractors.FirstOrDefault(e => e.CanHandle(sourceFilePath))
            ?? throw new NotSupportedException($"Unsupported ebook file type: {Path.GetExtension(sourceFilePath)}");

        var metadata = await extractor.ExtractAsync(sourceFilePath, ct);
        var contentHash = await ComputeSha256Async(sourceFilePath, ct);
        var format = DetectFormat(sourceFilePath);

        var bookId = Guid.NewGuid();
        var sortTitle = TitleSorting.ComputeSortTitle(metadata.Title);

        var authors = await EntityResolvers.ResolveAuthorsAsync(db, metadata.Authors, ct);

        var authorFolderSegment = FileNaming.SanitizePathSegment(
            authors.Count > 0 ? authors[0].SortName : "Unknown Author");
        var bookFolderSegment = FileNaming.SanitizePathSegment($"{metadata.Title} ({bookId})");
        var relativeFolder = Path.Combine(authorFolderSegment, bookFolderSegment);
        var absoluteFolder = Path.Combine(libraryRoot, relativeFolder);

        Directory.CreateDirectory(absoluteFolder);
        try
        {
            var destFileName = FileNaming.SanitizePathSegment(metadata.Title) +
                Path.GetExtension(sourceFilePath).ToLowerInvariant();
            var destFilePath = Path.Combine(absoluteFolder, destFileName);
            File.Copy(sourceFilePath, destFilePath, overwrite: false);

            if (metadata.CoverImageBytes is { Length: > 0 })
            {
                var coverExtension = CoverExtensionFor(metadata.CoverContentType);
                await File.WriteAllBytesAsync(
                    Path.Combine(absoluteFolder, $"cover.{coverExtension}"), metadata.CoverImageBytes, ct);
            }

            var book = new Book
            {
                Id = bookId,
                Title = metadata.Title,
                SortTitle = sortTitle,
                Description = metadata.Description,
                Language = metadata.Language,
                Publisher = metadata.Publisher,
                DatePublished = metadata.PublishedDate,
                FolderPath = relativeFolder,
            };

            for (var i = 0; i < authors.Count; i++)
            {
                book.BookAuthors.Add(new BookAuthor { BookId = bookId, Author = authors[i], Order = i });
            }

            book.Files.Add(new BookFile
            {
                BookId = bookId,
                Format = format,
                FilePath = Path.Combine(relativeFolder, destFileName),
                FileSizeBytes = new FileInfo(destFilePath).Length,
                ContentHash = contentHash,
            });

            foreach (var identifier in metadata.Identifiers)
            {
                book.Identifiers.Add(new Identifier
                {
                    BookId = bookId,
                    Scheme = identifier.Scheme,
                    Value = identifier.Value,
                });
            }

            db.Books.Add(book);
            await db.SaveChangesAsync(ct);

            return book;
        }
        catch
        {
            Directory.Delete(absoluteFolder, recursive: true);
            throw;
        }
    }

    private static BookFormat DetectFormat(string filePath) => Path.GetExtension(filePath).ToLowerInvariant() switch
    {
        ".epub" => BookFormat.Epub,
        ".pdf" => BookFormat.Pdf,
        var ext => throw new NotSupportedException($"Unsupported ebook file type: {ext}"),
    };

    private static string CoverExtensionFor(string? contentType) => contentType switch
    {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        _ => "jpg",
    };

    private static async Task<string> ComputeSha256Async(string filePath, CancellationToken ct)
    {
        await using var stream = File.OpenRead(filePath);
        var hashBytes = await SHA256.HashDataAsync(stream, ct);
        return Convert.ToHexString(hashBytes).ToLowerInvariant();
    }
}
