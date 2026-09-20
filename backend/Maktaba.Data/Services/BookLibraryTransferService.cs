using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

/// <summary>
/// See <see cref="IBookLibraryTransferService"/>. The target library's own <c>MaktabaDbContext</c> is
/// a throwaway, hand-built one (not the DI-registered <c>MaktabaDbContext</c>, which always tracks
/// whichever library is currently *active*) - constructed straight from
/// <see cref="IStorageProvider.PullDatabaseAsync"/>'s local path the same way
/// <c>MaktabaDbContextFactory.Create</c> builds the active one, just pointed at a second,
/// independent library's database file instead. This never touches
/// <see cref="ILibraryService.CurrentLibraryId"/> at all - the app's active library stays exactly
/// what it was for the whole operation.
/// </summary>
public class BookLibraryTransferService(
    MaktabaDbContext sourceDb,
    ILibraryService libraryService,
    IStorageProviderFactory storageFactory,
    ICloudCredentialCache credentials,
    IBookRemovalService bookRemovalService) : IBookLibraryTransferService
{
    public async Task<BookTransferResult> TransferAsync(
        int bookId, string targetLibraryId, bool deleteFromSource, CancellationToken ct = default)
    {
        var sourceEntry = libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId);
        if (sourceEntry?.ProviderType == "nawishta")
        {
            return new BookTransferResult(
                BookTransferOutcome.UnsupportedProvider,
                ErrorMessage: "Copying or moving books isn't supported yet for a Nawishta-backed library.");
        }

        if (targetLibraryId == libraryService.CurrentLibraryId)
        {
            return new BookTransferResult(
                BookTransferOutcome.SameLibrary, ErrorMessage: "Pick a different library to copy or move this book to.");
        }

        var targetEntry = libraryService.Libraries.FirstOrDefault(l => l.Id == targetLibraryId);
        if (targetEntry is null)
        {
            return new BookTransferResult(BookTransferOutcome.TargetLibraryNotFound);
        }

        if (targetEntry.ProviderType == "nawishta")
        {
            return new BookTransferResult(
                BookTransferOutcome.UnsupportedProvider,
                ErrorMessage: "Copying or moving books to a Nawishta-backed library isn't supported yet.");
        }

        var book = await sourceDb.Books
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
            .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
            .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
            .Include(b => b.Files)
            .Include(b => b.Identifiers)
            .Include(b => b.Periodical)
            .FirstOrDefaultAsync(b => b.Id == bookId, ct);

        if (book is null)
        {
            return new BookTransferResult(BookTransferOutcome.SourceBookNotFound);
        }

        IStorageProvider targetProvider;
        if (targetEntry.ProviderType == "local")
        {
            // Deliberately not storageFactory.CreateForProvider here - "local" always resolves to
            // the one shared LocalFileSystemProvider singleton, which is bound to whichever library
            // is currently *active* (see AdHocLocalStorageProvider's own doc comment). Using it for
            // a non-active local target would silently read/write the active library's own files
            // and metadata.db instead of the target's - exactly the "copy landed in the same
            // library" bug this class exists to avoid.
            targetProvider = new AdHocLocalStorageProvider(targetEntry.Path);
        }
        else
        {
            if (!credentials.TryGet(targetEntry.Id, out var credential))
            {
                return new BookTransferResult(
                    BookTransferOutcome.CredentialMissing,
                    ErrorMessage:
                    $"\"{targetEntry.Name}\" hasn't been connected this session yet - open it once (Settings -> Libraries) before copying or moving books into it.");
            }

            targetProvider = storageFactory.CreateForProvider(
                targetEntry.Id, targetEntry.ProviderType, targetEntry.ProviderConfig ?? new Dictionary<string, string>(), credential);
        }

        var sourceStorage = storageFactory.Current;

        var targetDbPath = await targetProvider.PullDatabaseAsync(ct);
        var targetDbOptions = new DbContextOptionsBuilder<MaktabaDbContext>().UseSqlite($"Data Source={targetDbPath}").Options;
        await using var targetDb = new MaktabaDbContext(targetDbOptions);
        await targetDb.Database.EnsureCreatedAsync(ct);

        try
        {
            var authorNames = book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToList();
            var authors = await EntityResolvers.ResolveAuthorsAsync(targetDb, authorNames, ct);

            var sourceSeries = book.BookSeries.FirstOrDefault();
            var series = await EntityResolvers.ResolveSeriesAsync(targetDb, sourceSeries?.Series.Name, ct);

            var tags = await EntityResolvers.ResolveTagsAsync(targetDb, book.BookTags.Select(bt => bt.Tag.Name).ToList(), ct);

            var collections = new List<Collection>();
            foreach (var name in book.BookCollections.Select(bc => bc.Collection.Name))
            {
                collections.Add(await ResolveCollectionAsync(targetDb, name, ct));
            }

            var targetPeriodical = book.Periodical is { } sourcePeriodical
                ? await ResolvePeriodicalAsync(targetDb, targetProvider, sourcePeriodical, ct)
                : null;

            var newBook = new Book
            {
                Title = book.Title,
                SortTitle = book.SortTitle,
                Description = book.Description,
                Language = book.Language,
                Publisher = book.Publisher,
                DatePublished = book.DatePublished,
                DateAdded = book.DateAdded,
                Rating = book.Rating,
                ReadingStatus = book.ReadingStatus,
                PageCount = book.PageCount,
                PeriodicalId = targetPeriodical?.Id,
                IssueNumber = book.IssueNumber,
                VolumeNumber = book.VolumeNumber,
                IssueDate = book.IssueDate,
            };

            for (var i = 0; i < authors.Count; i++)
            {
                newBook.BookAuthors.Add(new BookAuthor { Author = authors[i], Order = i });
            }

            if (series is not null)
            {
                newBook.BookSeries.Add(new BookSeries { Series = series, SeriesIndex = sourceSeries!.SeriesIndex });
            }

            foreach (var tag in tags)
            {
                newBook.BookTags.Add(new BookTag { Tag = tag });
            }

            foreach (var collection in collections)
            {
                newBook.BookCollections.Add(new BookCollection { Collection = collection });
            }

            foreach (var identifier in book.Identifiers)
            {
                newBook.Identifiers.Add(new Identifier { Scheme = identifier.Scheme, Value = identifier.Value });
            }

            // The on-disk folder name embeds the new book's id (see LibraryPathBuilder), which only
            // exists once the row is actually inserted - same two-step "insert, then fill in
            // FolderPath/Files" sequence ImportService.ImportFileAsync uses for a brand-new book.
            targetDb.Books.Add(newBook);
            await targetDb.SaveChangesAsync(ct);

            var relativeFolder = targetPeriodical is not null
                ? LibraryPathBuilder.IssueFolderPath(targetPeriodical.Name, targetPeriodical.Id, newBook.Title, newBook.Id)
                : LibraryPathBuilder.BookFolderPath(authors.Count > 0 ? authors[0].SortName : null, newBook.Title, newBook.Id);

            await targetProvider.CreateDirectoryAsync(relativeFolder, ct);
            var targetAbsoluteFolder = await targetProvider.GetLocalPathAsync(relativeFolder, ct);

            foreach (var file in book.Files)
            {
                var sourceAbsolutePath = await sourceStorage.GetLocalPathAsync(file.FilePath, ct);
                var destFileName = Path.GetFileName(file.FilePath);
                var destAbsolutePath = Path.Combine(targetAbsoluteFolder, destFileName);
                File.Copy(sourceAbsolutePath, destAbsolutePath, overwrite: true);
                var destRelativePath = Path.Combine(relativeFolder, destFileName);
                await targetProvider.NotifyWrittenAsync(destRelativePath, ct);

                newBook.Files.Add(new BookFile
                {
                    Format = file.Format,
                    FilePath = destRelativePath,
                    FileSizeBytes = file.FileSizeBytes,
                    ContentHash = file.ContentHash,
                    IsCustomNamed = file.IsCustomNamed,
                });
            }

            // Best-effort, same as ImportService's own cover write - a missing/unreadable source
            // cover shouldn't fail the whole transfer, the book itself is still worth having.
            var cover = await CoverLocator.FindAsync(sourceStorage, book.FolderPath, ct);
            if (cover is { } found)
            {
                var coverFileName = Path.GetFileName(found.FilePath);
                File.Copy(found.FilePath, Path.Combine(targetAbsoluteFolder, coverFileName), overwrite: true);
                await targetProvider.NotifyWrittenAsync(Path.Combine(relativeFolder, coverFileName), ct);
            }

            newBook.FolderPath = relativeFolder;
            await targetDb.SaveChangesAsync(ct);

            // See CLAUDE.md's "known sharp edge" - the target db's connection pool has to be flushed
            // before PushDatabaseAsync can safely overwrite/re-read metadata.db's bytes for a cloud
            // library (a no-op call for a local one).
            SqliteConnection.ClearAllPools();
            await targetProvider.PushDatabaseAsync(ct);

            BookRemovalResult? sourceRemoval = null;
            if (deleteFromSource)
            {
                sourceRemoval = await bookRemovalService.RemoveAsync(bookId, ct);
            }

            return new BookTransferResult(BookTransferOutcome.Success, newBook.Id, SourceRemoval: sourceRemoval);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return new BookTransferResult(BookTransferOutcome.Failed, ErrorMessage: ex.Message);
        }
    }

    private static async Task<Periodical> ResolvePeriodicalAsync(
        MaktabaDbContext targetDb, IStorageProvider targetProvider, Periodical sourcePeriodical, CancellationToken ct)
    {
        var trimmed = sourcePeriodical.Name.Trim();
        var existing = await targetDb.Periodicals.FirstOrDefaultAsync(p => p.Name.ToLower() == trimmed.ToLower(), ct);
        if (existing is not null)
        {
            return existing;
        }

        var created = new Periodical
        {
            Name = sourcePeriodical.Name,
            SortName = sourcePeriodical.SortName,
            Description = sourcePeriodical.Description,
            Frequency = sourcePeriodical.Frequency,
            Language = sourcePeriodical.Language,
            Publisher = sourcePeriodical.Publisher,
            Editor = sourcePeriodical.Editor,
        };
        targetDb.Periodicals.Add(created);
        await targetDb.SaveChangesAsync(ct);

        created.FolderPath = LibraryPathBuilder.PeriodicalFolderPath(created.Name, created.Id);
        await targetProvider.CreateDirectoryAsync(created.FolderPath, ct);
        await targetDb.SaveChangesAsync(ct);

        return created;
    }

    // Collections are user-authored only (never find-or-create from free text elsewhere - see
    // CLAUDE.md) but a cross-library copy still needs a target-side row to attach to, so this mirrors
    // EntityResolvers.ResolveTagsAsync's own case-insensitive match-or-create rather than reusing it
    // directly (no ResolveCollectionsAsync exists, by design). Flattened to a top-level collection in
    // the target regardless of any parent/child nesting the source had - out of scope for this pass.
    private static async Task<Collection> ResolveCollectionAsync(MaktabaDbContext targetDb, string name, CancellationToken ct)
    {
        var trimmed = name.Trim();
        var existing = await targetDb.Collections.FirstOrDefaultAsync(c => c.Name.ToLower() == trimmed.ToLower(), ct);
        if (existing is not null)
        {
            return existing;
        }

        var created = new Collection { Name = trimmed };
        targetDb.Collections.Add(created);
        return created;
    }
}
