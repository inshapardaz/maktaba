using System.Text.RegularExpressions;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public partial class LibraryRescanService(
    MaktabaDbContext db,
    ILibraryPathProvider libraryPath,
    IEnumerable<IBookMetadataExtractor> extractors) : ILibraryRescanService
{
    // The trailing "(...)" is expected to be a sqid (see IdCodec) - actual validity is checked by
    // trying to decode it, rather than matching the sqid alphabet/length here, since both are
    // implementation details of the shared encoder rather than something worth duplicating in a regex.
    [GeneratedRegex(@"^(?<title>.+) \((?<id>[^()]+)\)$")]
    private static partial Regex BookFolderPattern();

    public async Task<int> RescanAsync(CancellationToken ct = default)
    {
        var libraryRoot = libraryPath.LibraryRootPath!;

        // Wipe the index (children before parents, to satisfy FK constraints) - metadata.db is designed
        // to be a rebuildable cache over the on-disk layout (see docs/SPEC.md §4).
        await db.BookAuthors.ExecuteDeleteAsync(ct);
        await db.BookSeries.ExecuteDeleteAsync(ct);
        await db.BookTags.ExecuteDeleteAsync(ct);
        await db.Identifiers.ExecuteDeleteAsync(ct);
        await db.BookFiles.ExecuteDeleteAsync(ct);
        await db.Books.ExecuteDeleteAsync(ct);
        await db.Authors.ExecuteDeleteAsync(ct);
        await db.Series.ExecuteDeleteAsync(ct);
        await db.Tags.ExecuteDeleteAsync(ct);

        var importedCount = 0;

        foreach (var authorDir in Directory.EnumerateDirectories(libraryRoot))
        {
            foreach (var bookDir in Directory.EnumerateDirectories(authorDir))
            {
                ct.ThrowIfCancellationRequested();

                if (await TryIndexBookFolderAsync(libraryRoot, bookDir, ct))
                {
                    importedCount++;
                }
            }
        }

        await db.SaveChangesAsync(ct);

        return importedCount;
    }

    private async Task<bool> TryIndexBookFolderAsync(string libraryRoot, string bookDir, CancellationToken ct)
    {
        var match = BookFolderPattern().Match(Path.GetFileName(bookDir));
        if (!match.Success || !IdCodec.TryDecode(match.Groups["id"].Value, out var bookId))
        {
            // Not one of our own "{Title} ({BookId})" folders - skip (see ILibraryRescanService docs).
            return false;
        }

        var ebookFiles = Directory.EnumerateFiles(bookDir)
            .Where(f => extractors.Any(e => e.CanHandle(f)))
            .ToList();

        if (ebookFiles.Count == 0)
        {
            return false;
        }

        var relativeFolder = Path.GetRelativePath(libraryRoot, bookDir);
        Book? book = null;

        foreach (var filePath in ebookFiles)
        {
            var extractor = extractors.First(e => e.CanHandle(filePath));
            var metadata = await extractor.ExtractAsync(filePath, ct);
            var hash = await EbookFileHelpers.ComputeSha256Async(filePath, ct);
            var format = EbookFileHelpers.DetectFormat(filePath);

            if (book is null)
            {
                var authors = await EntityResolvers.ResolveAuthorsAsync(db, metadata.Authors, ct);
                book = new Book
                {
                    Id = bookId,
                    Title = metadata.Title,
                    SortTitle = TitleSorting.ComputeSortTitle(metadata.Title),
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
            }

            book.Files.Add(new BookFile
            {
                BookId = bookId,
                Format = format,
                FilePath = Path.Combine(relativeFolder, Path.GetFileName(filePath)),
                FileSizeBytes = new FileInfo(filePath).Length,
                ContentHash = hash,
            });
        }

        return true;
    }
}
