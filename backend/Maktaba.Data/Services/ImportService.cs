using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
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

        // Always checked (regardless of resolution) so KeepBoth below knows whether it's actually
        // creating a sibling of a real duplicate (title needs disambiguating) or just happened to be
        // pre-selected with no genuine collision (title left untouched).
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

        // KeepBoth falls through to here even when a duplicate was found (case ImportDuplicateResolution.KeepBoth
        // isn't handled above, so the switch has no effect on it) - "Token" alongside an existing "Token"
        // becomes "Token (2)", same numbering style as EbookFileHelpers.GetUniqueFilePath uses for filenames.
        var title = duplicate is not null ? await GetUniqueTitleAsync(metadata.Title, ct) : metadata.Title;
        var sortTitle = TitleSorting.ComputeSortTitle(title);
        var authors = await EntityResolvers.ResolveAuthorsAsync(db, metadata.Authors, ct);

        var book = new Book
        {
            Title = title,
            SortTitle = sortTitle,
            Description = metadata.Description,
            Language = metadata.Language ?? "en",
            Publisher = metadata.Publisher,
            DatePublished = metadata.PublishedDate,
        };

        for (var i = 0; i < authors.Count; i++)
        {
            book.BookAuthors.Add(new BookAuthor { Author = authors[i], Order = i });
        }

        foreach (var identifier in metadata.Identifiers)
        {
            book.Identifiers.Add(new Identifier { Scheme = identifier.Scheme, Value = identifier.Value });
        }

        // The on-disk folder name embeds this book's id (as a sqid, so a rescan can recover it), which
        // means the id has to exist before the folder can be created - so this book row is inserted
        // first (letting SQLite assign the auto-increment id), and the folder/file/FolderPath are filled
        // in afterwards inside the same transaction, which is rolled back if anything below fails.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.Books.Add(book);
        await db.SaveChangesAsync(ct);

        var authorFolderSegment = FileNaming.SanitizePathSegment(
            authors.Count > 0 ? authors[0].SortName : "Unknown Author");
        var bookFolderSegment = FileNaming.SanitizePathSegment($"{title} ({IdCodec.Encode(book.Id)})");
        var relativeFolder = Path.Combine(authorFolderSegment, bookFolderSegment);
        var absoluteFolder = Path.Combine(libraryRoot, relativeFolder);

        Directory.CreateDirectory(absoluteFolder);
        try
        {
            var destFileName = FileNaming.SanitizePathSegment(title) +
                Path.GetExtension(sourceFilePath).ToLowerInvariant();
            var destFilePath = Path.Combine(absoluteFolder, destFileName);
            File.Copy(sourceFilePath, destFilePath, overwrite: false);

            if (metadata.CoverImageBytes is { Length: > 0 })
            {
                var coverExtension = EbookFileHelpers.CoverExtensionFor(metadata.CoverContentType);
                await File.WriteAllBytesAsync(
                    Path.Combine(absoluteFolder, $"cover.{coverExtension}"), metadata.CoverImageBytes, ct);
            }

            book.FolderPath = relativeFolder;
            book.Files.Add(new BookFile
            {
                Format = format,
                FilePath = Path.Combine(relativeFolder, destFileName),
                FileSizeBytes = new FileInfo(destFilePath).Length,
                ContentHash = contentHash,
            });

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            return book;
        }
        catch
        {
            // Transaction rolls back (undoing the book insert) on dispose since it was never committed.
            Directory.Delete(absoluteFolder, recursive: true);
            throw;
        }
    }

    public async Task<Book?> AddFileToBookAsync(int bookId, string sourceFilePath, CancellationToken ct = default)
    {
        var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return null;
        }

        var format = EbookFileHelpers.DetectFormat(sourceFilePath);
        var contentHash = await EbookFileHelpers.ComputeSha256Async(sourceFilePath, ct);
        return await MergeFileIntoExistingBookAsync(book, sourceFilePath, format, contentHash, ct);
    }

    // "Token" -> "Token (2)" -> "Token (3)", checked against every existing title (not just the one
    // known duplicate) so repeated keep-both imports of the same book don't collide with each other.
    private async Task<string> GetUniqueTitleAsync(string title, CancellationToken ct)
    {
        if (!await db.Books.AnyAsync(b => b.Title == title, ct))
        {
            return title;
        }

        var n = 2;
        string candidate;
        do
        {
            candidate = $"{title} ({n})";
            n++;
        } while (await db.Books.AnyAsync(b => b.Title == candidate, ct));

        return candidate;
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
