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
    IEnumerable<IBookMetadataExtractor> extractors,
    IRescanProgressTracker progress) : ILibraryRescanService
{
    // The trailing "(...)" is expected to be a sqid (see IdCodec) - actual validity is checked by
    // trying to decode it, rather than matching the sqid alphabet/length here, since both are
    // implementation details of the shared encoder rather than something worth duplicating in a regex.
    [GeneratedRegex(@"^(?<title>.+) \((?<id>[^()]+)\)$")]
    private static partial Regex BookFolderPattern();

    private sealed record SeriesInfo(string Name, double Index);

    // Everything here is DB-only state a rescan can't re-derive from the file itself (see
    // ILibraryRescanService docs) - captured per book id before the wipe below, and reapplied to
    // the rebuilt row for any book whose folder (and therefore id) still exists, rather than
    // silently resetting it on every rescan.
    private sealed record PreviousBookState(
        int Rating,
        ReadingStatus ReadingStatus,
        DateTime DateAdded,
        List<string> TagNames,
        SeriesInfo? Series,
        List<int> CollectionIds);

    public async Task<int> RescanAsync(CancellationToken ct = default)
    {
        var libraryRoot = libraryPath.LibraryRootPath!;

        // Flattened up front (rather than the nested author/book enumeration this used to be) so the
        // total is known before the loop starts - GET /api/libraries/rescan/progress reports against
        // this total while the rescan below is still running on the request thread that called us.
        var bookDirs = Directory.EnumerateDirectories(libraryRoot)
            .SelectMany(Directory.EnumerateDirectories)
            .ToList();

        progress.Start(bookDirs.Count);
        try
        {
            // Everything below - the wipe and the rebuild - runs inside one transaction. If the scan
            // throws or is cancelled partway (a corrupt file, the request being aborted, ...), disposing
            // the transaction without committing rolls the whole thing back, leaving the previous index
            // intact instead of stuck half-wiped (which used to present as "rescan doesn't finish" -
            // the library would come back empty, and re-importing the same folder from there produced
            // real duplicate copies on disk).
            await using var transaction = await db.Database.BeginTransactionAsync(ct);

            var previousStates = await LoadPreviousBookStatesAsync(ct);

            // Wipe the index (children before parents, to satisfy FK constraints) - metadata.db is designed
            // to be a rebuildable cache over the on-disk layout (see docs/SPEC.md §4). Collections
            // themselves are user-authored (not derived from file metadata) and survive a rescan, but
            // per-book membership does not - it's re-set explicitly from previousStates below, same as
            // ratings, reading status, tags, series, and DateAdded.
            await db.BookAuthors.ExecuteDeleteAsync(ct);
            await db.BookSeries.ExecuteDeleteAsync(ct);
            await db.BookTags.ExecuteDeleteAsync(ct);
            await db.BookCollections.ExecuteDeleteAsync(ct);
            await db.Identifiers.ExecuteDeleteAsync(ct);
            await db.BookFiles.ExecuteDeleteAsync(ct);
            await db.Books.ExecuteDeleteAsync(ct);
            await db.Authors.ExecuteDeleteAsync(ct);
            await db.Series.ExecuteDeleteAsync(ct);
            await db.Tags.ExecuteDeleteAsync(ct);

            var importedCount = 0;

            for (var i = 0; i < bookDirs.Count; i++)
            {
                ct.ThrowIfCancellationRequested();

                var bookDir = bookDirs[i];
                if (await TryIndexBookFolderAsync(libraryRoot, bookDir, previousStates, ct))
                {
                    importedCount++;

                    // Flushed now (within the still-open transaction, not yet durably committed) so
                    // the next book's EntityResolvers lookups - plain DB queries, blind to unflushed
                    // change-tracker inserts - see the authors/series/tags this book just created
                    // instead of re-creating duplicates for every book after the first by a given
                    // author (the actual cause of books "coming back" duplicated after a rescan).
                    await db.SaveChangesAsync(ct);
                }

                progress.Report(i + 1, Path.GetFileName(bookDir));
            }

            await transaction.CommitAsync(ct);

            return importedCount;
        }
        finally
        {
            // Always clears IsRunning, success or failure, so a poller never gets stuck believing a
            // rescan that errored out (or was cancelled) is still going.
            progress.Complete();
        }
    }

    private async Task<Dictionary<int, PreviousBookState>> LoadPreviousBookStatesAsync(CancellationToken ct)
    {
        var books = await db.Books
            .Select(b => new { b.Id, b.Rating, b.ReadingStatus, b.DateAdded })
            .ToListAsync(ct);

        var tags = await db.BookTags
            .Select(bt => new { bt.BookId, TagName = bt.Tag.Name })
            .ToListAsync(ct);

        var series = await db.BookSeries
            .Select(bs => new { bs.BookId, SeriesName = bs.Series.Name, bs.SeriesIndex })
            .ToListAsync(ct);

        var collections = await db.BookCollections
            .Select(bc => new { bc.BookId, bc.CollectionId })
            .ToListAsync(ct);

        return books.ToDictionary(
            b => b.Id,
            b => new PreviousBookState(
                b.Rating,
                b.ReadingStatus,
                b.DateAdded,
                tags.Where(t => t.BookId == b.Id).Select(t => t.TagName).ToList(),
                series.Where(s => s.BookId == b.Id).Select(s => new SeriesInfo(s.SeriesName, s.SeriesIndex)).FirstOrDefault(),
                collections.Where(c => c.BookId == b.Id).Select(c => c.CollectionId).ToList()));
    }

    private async Task<bool> TryIndexBookFolderAsync(
        string libraryRoot, string bookDir, IReadOnlyDictionary<int, PreviousBookState> previousStates, CancellationToken ct)
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

                if (previousStates.TryGetValue(bookId, out var previous))
                {
                    book.DateAdded = previous.DateAdded;
                    book.Rating = previous.Rating;
                    book.ReadingStatus = previous.ReadingStatus;

                    var tags = await EntityResolvers.ResolveTagsAsync(db, previous.TagNames, ct);
                    foreach (var tag in tags)
                    {
                        book.BookTags.Add(new BookTag { BookId = bookId, Tag = tag });
                    }

                    if (previous.Series is { } previousSeries)
                    {
                        var series = await EntityResolvers.ResolveSeriesAsync(db, previousSeries.Name, ct);
                        if (series is not null)
                        {
                            book.BookSeries.Add(new BookSeries { BookId = bookId, Series = series, SeriesIndex = previousSeries.Index });
                        }
                    }

                    foreach (var collectionId in previous.CollectionIds)
                    {
                        book.BookCollections.Add(new BookCollection { BookId = bookId, CollectionId = collectionId });
                    }
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
