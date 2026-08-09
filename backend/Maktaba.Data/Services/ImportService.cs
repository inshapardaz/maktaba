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
    public async Task<Book> ImportFileAsync(
        string sourceFilePath,
        ImportDuplicateResolution resolution = ImportDuplicateResolution.Auto,
        CancellationToken ct = default)
    {
        // MaktabaDbContext (a constructor dependency) already requires an open library to have been
        // constructed, so LibraryRootPath is guaranteed non-null by the time this method runs.
        var libraryRoot = libraryPath.LibraryRootPath!;

        var extractor = extractors.FirstOrDefault(e => e.CanHandle(sourceFilePath))
            ?? throw new NotSupportedException($"Unsupported ebook file type: {Path.GetExtension(sourceFilePath)}");

        var metadata = await extractor.ExtractAsync(sourceFilePath, ct);
        var contentHash = await EbookFileHelpers.ComputeSha256Async(sourceFilePath, ct);
        var format = EbookFileHelpers.DetectFormat(sourceFilePath);

        if (resolution != ImportDuplicateResolution.KeepBoth)
        {
            var duplicate = await FindDuplicateAsync(metadata.Title, metadata.Authors, contentHash, ct);
            if (duplicate is not null)
            {
                switch (resolution)
                {
                    case ImportDuplicateResolution.Auto:
                        throw new DuplicateBookDetectedException(
                            duplicate.Value.Book.Id,
                            duplicate.Value.Book.Title,
                            duplicate.Value.Book.BookAuthors.Select(ba => ba.Author.Name).ToArray(),
                            duplicate.Value.SameContentHash);
                    case ImportDuplicateResolution.Skip:
                        return duplicate.Value.Book;
                    case ImportDuplicateResolution.Merge:
                        return await MergeFileIntoExistingBookAsync(
                            duplicate.Value.Book, sourceFilePath, format, contentHash, ct);
                }
            }
        }

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
                var coverExtension = EbookFileHelpers.CoverExtensionFor(metadata.CoverContentType);
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

    private async Task<(Book Book, bool SameContentHash)?> FindDuplicateAsync(
        string title, IReadOnlyList<string> authorNames, string contentHash, CancellationToken ct)
    {
        var hashMatch = await db.BookFiles
            .Include(f => f.Book).ThenInclude(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .FirstOrDefaultAsync(f => f.ContentHash == contentHash, ct);
        if (hashMatch is not null)
        {
            return (hashMatch.Book, true);
        }

        var normalizedTitle = title.Trim().ToLowerInvariant();
        var normalizedAuthors = authorNames.Select(a => a.Trim().ToLowerInvariant()).ToHashSet();

        var titleCandidates = await db.Books
            .Where(b => b.Title.ToLower() == normalizedTitle)
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .ToListAsync(ct);

        var titleAndAuthorMatch = titleCandidates.FirstOrDefault(b =>
            b.BookAuthors.Any(ba => normalizedAuthors.Contains(ba.Author.Name.ToLowerInvariant())));

        return titleAndAuthorMatch is not null ? (titleAndAuthorMatch, false) : null;
    }

    private async Task<Book> MergeFileIntoExistingBookAsync(
        Book existingBook, string sourceFilePath, BookFormat format, string contentHash, CancellationToken ct)
    {
        var libraryRoot = libraryPath.LibraryRootPath!;
        var folderAbsolute = Path.Combine(libraryRoot, existingBook.FolderPath);
        Directory.CreateDirectory(folderAbsolute);

        var baseFileName = FileNaming.SanitizePathSegment(existingBook.Title) +
            Path.GetExtension(sourceFilePath).ToLowerInvariant();
        var destFilePath = EbookFileHelpers.GetUniqueFilePath(folderAbsolute, baseFileName);
        File.Copy(sourceFilePath, destFilePath, overwrite: false);

        db.BookFiles.Add(new BookFile
        {
            BookId = existingBook.Id,
            Format = format,
            FilePath = Path.Combine(existingBook.FolderPath, Path.GetFileName(destFilePath)),
            FileSizeBytes = new FileInfo(destFilePath).Length,
            ContentHash = contentHash,
        });

        await db.SaveChangesAsync(ct);

        return existingBook;
    }
}
