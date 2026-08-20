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

    private sealed record IdentifierInfo(string Scheme, string Value);

    private sealed record BookmarkInfo(
        string ClientId, string ChapterId, double Position, string Name, DateTime CreatedAt, DateTime? UpdatedAt);

    private sealed record NoteInfo(
        string ClientId, string ChapterId, int StartOffset, int EndOffset, string Text, string? Comment,
        DateTime CreatedAt, DateTime? UpdatedAt);

    private sealed record ProgressInfo(
        int CurrentChapter, int TotalChapters, int CurrentPage, int TotalPages, string? ChapterTitle,
        double Percentage, string? ChapterId, double? Position, DateTime UpdatedAt);

    // Captured per book id before the wipe below, and reapplied to the rebuilt row for any book
    // whose folder (and therefore id) still exists, rather than silently resetting it on every
    // rescan. This covers two different kinds of state: DB-only fields a rescan can't re-derive
    // from the file at all (Rating/ReadingStatus/DateAdded/tags/series/collections/bookmarks/
    // notes/progress), and - since issue #15 - file-derived metadata too (Title/SortTitle/
    // Description/Language/Publisher/DatePublished/Authors/Identifiers). The latter *could* be
    // re-extracted from the file, but deliberately isn't: embedded EPUB/PDF metadata is often
    // stale or wrong compared to what the user has since edited in the app (title corrections,
    // fixed author names, ...), and a rescan silently clobbering those edits on every run was
    // exactly the bug report. Only a genuinely new book (no previous state) has its metadata
    // extracted from the file - see TryIndexBookFolderAsync.
    private sealed record PreviousBookState(
        string Title,
        string SortTitle,
        string? Description,
        string? Language,
        string? Publisher,
        DateOnly? DatePublished,
        List<string> AuthorNames,
        List<IdentifierInfo> Identifiers,
        int Rating,
        ReadingStatus ReadingStatus,
        DateTime DateAdded,
        List<string> TagNames,
        SeriesInfo? Series,
        List<int> CollectionIds,
        List<BookmarkInfo> Bookmarks,
        List<NoteInfo> Notes,
        ProgressInfo? Progress);

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
            await db.Bookmarks.ExecuteDeleteAsync(ct);
            await db.Notes.ExecuteDeleteAsync(ct);
            await db.ReadingProgress.ExecuteDeleteAsync(ct);
            await db.Books.ExecuteDeleteAsync(ct);
            await db.Authors.ExecuteDeleteAsync(ct);
            await db.Series.ExecuteDeleteAsync(ct);
            await db.Tags.ExecuteDeleteAsync(ct);

            var importedCount = 0;

            for (var i = 0; i < bookDirs.Count; i++)
            {
                ct.ThrowIfCancellationRequested();

                var bookDir = bookDirs[i];
                try
                {
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
                }
                catch (Exception) when (ct.IsCancellationRequested == false)
                {
                    // A single book folder that can't be read (a permission error, a cloud-synced
                    // folder - OneDrive/Dropbox/etc. - still downloading, a corrupt file, ...) must not
                    // block every *other* book in the library from being correctly re-indexed, and just
                    // as importantly must not block books whose folders really were deleted from
                    // actually being pruned below: unlike the cancellation/hard-failure case (still
                    // meant to roll back the whole scan, see the comment on `transaction` above), this
                    // discards only the partial, never-saved entities this one book's attempt left in
                    // the change tracker and moves on to the rest.
                    db.ChangeTracker.Clear();
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
            .Select(b => new
            {
                b.Id,
                b.Title,
                b.SortTitle,
                b.Description,
                b.Language,
                b.Publisher,
                b.DatePublished,
                b.Rating,
                b.ReadingStatus,
                b.DateAdded,
            })
            .ToListAsync(ct);

        var authors = await db.BookAuthors
            .OrderBy(ba => ba.Order)
            .Select(ba => new { ba.BookId, AuthorName = ba.Author.Name })
            .ToListAsync(ct);

        var identifiers = await db.Identifiers
            .Select(i => new { i.BookId, i.Scheme, i.Value })
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

        var bookmarks = await db.Bookmarks
            .Select(bm => new { bm.BookId, Info = new BookmarkInfo(bm.ClientId, bm.ChapterId, bm.Position, bm.Name, bm.CreatedAt, bm.UpdatedAt) })
            .ToListAsync(ct);

        var notes = await db.Notes
            .Select(n => new { n.BookId, Info = new NoteInfo(n.ClientId, n.ChapterId, n.StartOffset, n.EndOffset, n.Text, n.Comment, n.CreatedAt, n.UpdatedAt) })
            .ToListAsync(ct);

        var progress = await db.ReadingProgress
            .Select(rp => new { rp.BookId, Info = new ProgressInfo(rp.CurrentChapter, rp.TotalChapters, rp.CurrentPage, rp.TotalPages, rp.ChapterTitle, rp.Percentage, rp.ChapterId, rp.Position, rp.UpdatedAt) })
            .ToListAsync(ct);

        return books.ToDictionary(
            b => b.Id,
            b => new PreviousBookState(
                b.Title,
                b.SortTitle,
                b.Description,
                b.Language,
                b.Publisher,
                b.DatePublished,
                authors.Where(a => a.BookId == b.Id).Select(a => a.AuthorName).ToList(),
                identifiers.Where(i => i.BookId == b.Id).Select(i => new IdentifierInfo(i.Scheme, i.Value)).ToList(),
                b.Rating,
                b.ReadingStatus,
                b.DateAdded,
                tags.Where(t => t.BookId == b.Id).Select(t => t.TagName).ToList(),
                series.Where(s => s.BookId == b.Id).Select(s => new SeriesInfo(s.SeriesName, s.SeriesIndex)).FirstOrDefault(),
                collections.Where(c => c.BookId == b.Id).Select(c => c.CollectionId).ToList(),
                bookmarks.Where(bm => bm.BookId == b.Id).Select(bm => bm.Info).ToList(),
                notes.Where(n => n.BookId == b.Id).Select(n => n.Info).ToList(),
                progress.Where(p => p.BookId == b.Id).Select(p => p.Info).FirstOrDefault()));
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

        // issue #15: a book id already present before this rescan keeps its existing metadata
        // untouched (built straight from previousStates, no file extraction) - only a genuinely
        // new id gets its metadata read from the file, lazily on the first recognized file below.
        var book = previousStates.TryGetValue(bookId, out var previous)
            ? await BuildExistingBookAsync(bookId, relativeFolder, previous, ct)
            : null;

        foreach (var filePath in ebookFiles)
        {
            var hash = await EbookFileHelpers.ComputeSha256Async(filePath, ct);
            var format = EbookFileHelpers.DetectFormat(filePath);

            if (book is null)
            {
                var extractor = extractors.First(e => e.CanHandle(filePath));
                var metadata = await extractor.ExtractAsync(filePath, ct);
                book = await BuildNewBookAsync(bookId, relativeFolder, metadata, ct);
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

        db.Books.Add(book!);
        return true;
    }

    // Rebuilds an already-known book's row entirely from its own previously-saved state (issue
    // #15) - no file I/O, no metadata extraction, so embedded EPUB/PDF metadata can never
    // overwrite an edit the user made in the app. Structural bookkeeping (FolderPath) still tracks
    // wherever the folder currently sits, since that's a location detail, not user-editable
    // metadata; BookFiles are added by the caller from a fresh per-file read regardless (a
    // format/size/hash change on disk is exactly what a rescan should notice, even for a book
    // whose metadata is left alone).
    private async Task<Book> BuildExistingBookAsync(int bookId, string relativeFolder, PreviousBookState previous, CancellationToken ct)
    {
        var book = new Book
        {
            Id = bookId,
            Title = previous.Title,
            SortTitle = previous.SortTitle,
            Description = previous.Description,
            Language = previous.Language,
            Publisher = previous.Publisher,
            DatePublished = previous.DatePublished,
            FolderPath = relativeFolder,
            DateAdded = previous.DateAdded,
            Rating = previous.Rating,
            ReadingStatus = previous.ReadingStatus,
        };

        // previous.AuthorNames is already in credit order (loaded via OrderBy(ba => ba.Order) in
        // LoadPreviousBookStatesAsync), so re-assigning Order from the resolved list's index below
        // reproduces the original order without needing to carry the raw Order value separately.
        var authors = await EntityResolvers.ResolveAuthorsAsync(db, previous.AuthorNames, ct);
        for (var i = 0; i < authors.Count; i++)
        {
            book.BookAuthors.Add(new BookAuthor { BookId = bookId, Author = authors[i], Order = i });
        }

        foreach (var identifier in previous.Identifiers)
        {
            book.Identifiers.Add(new Identifier { BookId = bookId, Scheme = identifier.Scheme, Value = identifier.Value });
        }

        await RestorePreviousDbOnlyStateAsync(book, bookId, previous, ct);
        return book;
    }

    private async Task<Book> BuildNewBookAsync(int bookId, string relativeFolder, ExtractedBookMetadata metadata, CancellationToken ct)
    {
        var authors = await EntityResolvers.ResolveAuthorsAsync(db, metadata.Authors, ct);
        var book = new Book
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

        return book;
    }

    // The DB-only fields a rescan can't re-derive from the file at all (tags/series/collections/
    // bookmarks/notes/reading progress) - only ever called for a bookId that has a previous state,
    // i.e. from BuildExistingBookAsync above, kept as its own method purely for readability.
    private async Task RestorePreviousDbOnlyStateAsync(Book book, int bookId, PreviousBookState previous, CancellationToken ct)
    {
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

        foreach (var bookmark in previous.Bookmarks)
        {
            db.Bookmarks.Add(new Bookmark
            {
                BookId = bookId,
                ClientId = bookmark.ClientId,
                ChapterId = bookmark.ChapterId,
                Position = bookmark.Position,
                Name = bookmark.Name,
                CreatedAt = bookmark.CreatedAt,
                UpdatedAt = bookmark.UpdatedAt,
            });
        }

        foreach (var note in previous.Notes)
        {
            db.Notes.Add(new Note
            {
                BookId = bookId,
                ClientId = note.ClientId,
                ChapterId = note.ChapterId,
                StartOffset = note.StartOffset,
                EndOffset = note.EndOffset,
                Text = note.Text,
                Comment = note.Comment,
                CreatedAt = note.CreatedAt,
                UpdatedAt = note.UpdatedAt,
            });
        }

        if (previous.Progress is { } previousProgress)
        {
            db.ReadingProgress.Add(new ReadingProgress
            {
                BookId = bookId,
                CurrentChapter = previousProgress.CurrentChapter,
                TotalChapters = previousProgress.TotalChapters,
                CurrentPage = previousProgress.CurrentPage,
                TotalPages = previousProgress.TotalPages,
                ChapterTitle = previousProgress.ChapterTitle,
                Percentage = previousProgress.Percentage,
                ChapterId = previousProgress.ChapterId,
                Position = previousProgress.Position,
                UpdatedAt = previousProgress.UpdatedAt,
            });
        }
    }
}
