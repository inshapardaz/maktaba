using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Maktaba.Data.Services;
using Maktaba.Nawishta;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class BookEndpoints
{
    // PUT/PATCH/DELETE below branch on this rather than going through a registered
    // IBookEditService/IBookRemovalService (see NawishtaBookMutationService's own doc comment for
    // why it isn't one) - "nawishta" is the only provider type any of these three branches ever
    // take, every other provider keeps going through the existing EF-backed services unchanged.
    private static bool IsNawishtaLibrary(ILibraryService libraryService) =>
        libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId)?.ProviderType == "nawishta";

    // Shared by every endpoint below that builds a BookSummaryDto/ContinueReadingBookDto -
    // AuthorRefDto is the same "name + id + photo presence" shape BookDetailDto already uses for
    // BookDetailPanel's pills, so the Home view/grid rows can reuse it for avatars too.
    private static AuthorRefDto[] BuildAuthorRefs(IEnumerable<BookAuthor> bookAuthors, string root) =>
        bookAuthors
            .OrderBy(ba => ba.Order)
            .Select(ba => new AuthorRefDto(
                IdCodec.Encode(ba.AuthorId), ba.Author.Name, AuthorImageLocator.Find(root, ba.AuthorId) is not null))
            .ToArray();

    // Two or more attached files sharing a content hash - same "duplicate" definition
    // BookDetailPanel.tsx applies per-file, just rolled up to a single per-book flag for BookList.
    private static bool HasDuplicateFiles(IEnumerable<BookFile> files) =>
        files.GroupBy(f => f.ContentHash).Any(g => g.Count() > 1);

    // Decodes every filter/sort/page query param this endpoint accepts into the plain values
    // IBookQueryService.ListAsync expects (Nawishta epic, Phase A) - id-decoding/enum-parsing stays
    // an endpoint concern, not something every query-service implementation repeats. An id that
    // fails to decode can't match anything, so its filter is passed through as -1 rather than
    // treated as "no filter" - a malformed/stale id should yield an empty result.
    private static BookQueryFilters BuildFilters(
        string? search, string? authorId, string? seriesId, string? tagId, string? collectionId, string? periodicalId,
        bool? includeIssues, string? readingStatus, string? format, int? minRating, string? publisher, string? language,
        string? sortKey, string? sortDirection, int? page, int? pageSize)
    {
        int? DecodeOrSentinel(string? id) => id is null ? null : (IdCodec.TryDecode(id, out var decoded) ? decoded : -1);

        var statusParsed = Enum.TryParse<ReadingStatus>(readingStatus, ignoreCase: true, out var parsedStatus);
        var formatParsed = Enum.TryParse<BookFormat>(format, ignoreCase: true, out var parsedFormat);

        return new BookQueryFilters(
            Search: search,
            AuthorId: authorId == "unknown" ? null : DecodeOrSentinel(authorId),
            AuthorIsUnknown: authorId == "unknown",
            SeriesId: DecodeOrSentinel(seriesId),
            TagId: DecodeOrSentinel(tagId),
            CollectionId: DecodeOrSentinel(collectionId),
            PeriodicalId: DecodeOrSentinel(periodicalId),
            IncludeIssues: includeIssues == true,
            Publisher: publisher,
            Language: language,
            ReadingStatus: statusParsed ? parsedStatus : null,
            MinRating: minRating,
            Format: formatParsed ? parsedFormat : null,
            SortKey: sortKey,
            SortDirection: sortDirection,
            Page: page,
            PageSize: pageSize);
    }

    public static void MapBookEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books");

        group.MapGet("", async (
            ILibraryQueryServiceFactory queryServices,
            IStorageProviderFactory storageFactory,
            string? search,
            string? authorId,
            string? seriesId,
            string? tagId,
            string? collectionId,
            string? periodicalId,
            bool? includeIssues,
            string? readingStatus,
            string? format,
            int? minRating,
            string? publisher,
            string? language,
            string? sortKey,
            string? sortDirection,
            int? page,
            int? pageSize,
            CancellationToken ct) =>
        {
            var root = await storageFactory.Current.GetLocalPathAsync("", ct);

            var filters = BuildFilters(
                search, authorId, seriesId, tagId, collectionId, periodicalId, includeIssues, readingStatus, format,
                minRating, publisher, language, sortKey, sortDirection, page, pageSize);
            var result = await queryServices.Books.ListAsync(filters, ct);

            var dtos = result.Books
                .Select(b => new BookSummaryDto(
                    IdCodec.Encode(b.Id),
                    b.Title,
                    b.SortTitle,
                    b.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                    BuildAuthorRefs(b.BookAuthors, root),
                    b.Rating,
                    b.DateAdded,
                    CoverLocator.Find(root, b.FolderPath) is not null,
                    CoverLocator.GetVersion(root, b.FolderPath),
                    b.PageCount,
                    HasDuplicateFiles(b.Files),
                    b.ReadingStatus.ToString(),
                    b.BookSeries.FirstOrDefault()?.SeriesIndex,
                    b.BookSeries.FirstOrDefault()?.Series.Name,
                    b.BookTags.Select(bt => bt.Tag.Name).ToArray(),
                    b.BookCollections.Select(bc => bc.Collection.Name).ToArray(),
                    result.LastReadByBookId.TryGetValue(b.Id, out var lastRead) ? lastRead : null,
                    b.Files.Select(f => f.Format.ToString()).Distinct().ToArray(),
                    b.PeriodicalId is not null ? IdCodec.Encode(b.PeriodicalId.Value) : null,
                    b.Periodical?.Name,
                    b.Periodical?.Frequency.ToString(),
                    b.IssueNumber,
                    b.VolumeNumber,
                    b.IssueDate))
                .ToArray();

            return Results.Ok(new PagedBooksDto(dtos, result.TotalCount));
        });

        // Backs the Home view - every book whose ReadingStatus is "Reading", most recently touched
        // first. Starts from Books rather than ReadingProgress (as it used to) because a book can be
        // tagged "Reading" from BookDetailPanel's status dropdown without ever being opened in the
        // reader, so it would never get a ReadingProgress row at all - such a book still belongs
        // here (with 0% progress), it just sorts after ones that actually have progress. The
        // frontend still applies its own ReadingStatus == "Reading" filter defensively, but every
        // row from here now already satisfies it.
        group.MapGet("/continue-reading", async (
            ILibraryQueryServiceFactory queryServices, IStorageProviderFactory storageFactory, int? limit, bool? includeIssues,
            CancellationToken ct) =>
        {
            var storage = storageFactory.Current;
            var root = await storage.GetLocalPathAsync("", ct);

            var entries = await queryServices.Books.ListContinueReadingAsync(limit, includeIssues == true, ct);

            var dtos = new List<ContinueReadingBookDto>();
            foreach (var entry in entries)
            {
                var book = entry.Book;
                dtos.Add(new ContinueReadingBookDto(
                    IdCodec.Encode(book.Id),
                    book.Title,
                    book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                    BuildAuthorRefs(book.BookAuthors, root),
                    CoverLocator.Find(root, book.FolderPath) is not null,
                    CoverLocator.GetVersion(root, book.FolderPath),
                    book.ReadingStatus.ToString(),
                    (entry.File?.Format ?? BookFormat.Epub).ToString(),
                    entry.File is not null ? await storage.GetLocalPathAsync(entry.File.FilePath, ct) : "",
                    entry.Percentage,
                    entry.UpdatedAt));
            }

            return Results.Ok(dtos);
        });

        // Backs the Home view's "Recently Added" shelf - the newest books by DateAdded, regardless of
        // reading progress. Deliberately separate from /continue-reading: that feed only includes
        // books with a ReadingProgress row, so a freshly imported library (nothing opened yet) would
        // show nothing there even though there's plenty to display here.
        group.MapGet("/recently-added", async (
            ILibraryQueryServiceFactory queryServices, IStorageProviderFactory storageFactory, int? limit, bool? includeIssues,
            CancellationToken ct) =>
        {
            var root = await storageFactory.Current.GetLocalPathAsync("", ct);

            var books = await queryServices.Books.ListRecentlyAddedAsync(limit, includeIssues == true, ct);

            var dtos = books
                .Select(b => new BookSummaryDto(
                    IdCodec.Encode(b.Id),
                    b.Title,
                    b.SortTitle,
                    b.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                    BuildAuthorRefs(b.BookAuthors, root),
                    b.Rating,
                    b.DateAdded,
                    CoverLocator.Find(root, b.FolderPath) is not null,
                    CoverLocator.GetVersion(root, b.FolderPath),
                    b.PageCount,
                    HasDuplicateFiles(b.Files),
                    b.ReadingStatus.ToString(),
                    b.BookSeries.FirstOrDefault()?.SeriesIndex,
                    b.BookSeries.FirstOrDefault()?.Series.Name,
                    b.BookTags.Select(bt => bt.Tag.Name).ToArray(),
                    b.BookCollections.Select(bc => bc.Collection.Name).ToArray(),
                    null,
                    b.Files.Select(f => f.Format.ToString()).Distinct().ToArray(),
                    b.PeriodicalId is not null ? IdCodec.Encode(b.PeriodicalId.Value) : null,
                    b.Periodical?.Name,
                    b.Periodical?.Frequency.ToString(),
                    b.IssueNumber,
                    b.VolumeNumber,
                    b.IssueDate))
                .ToList();

            return Results.Ok(dtos);
        });

        group.MapGet("/{id}", async (string id, ILibraryQueryServiceFactory queryServices, IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var storage = storageFactory.Current;
            var root = await storage.GetLocalPathAsync("", ct);

            var book = await queryServices.Books.GetByIdAsync(bookId, ct);

            if (book is null)
            {
                return Results.NotFound();
            }

            var series = book.BookSeries.FirstOrDefault();

            var (secondsRead, percentage) = await queryServices.Books.GetReadingStatsAsync(bookId, ct);
            var expectedTotalSeconds = ReadingTimeEstimator.EstimateTotalSeconds(secondsRead, percentage ?? 0);

            var fileDtos = new List<BookFileDto>();
            foreach (var f in book.Files)
            {
                // A remote provider's GetLocalPathAsync can genuinely fail (a dead network, a
                // revoked credential, or - confirmed live against a real Nawishta account - a
                // server-side bug in its own advertised "download" link for some content) without
                // that meaning the whole book detail view should 500: the title/authors/etc. below
                // are still valid and worth showing, with this one file just not openable until
                // whatever's wrong resolves. An empty AbsolutePath (BookFileDto's own type is
                // non-nullable string, not worth a wire-contract change here) means "couldn't
                // resolve this file right now" - opening it fails the same way any other missing/
                // unreadable file already does.
                string absolutePath;
                try
                {
                    absolutePath = await storage.GetLocalPathAsync(f.FilePath, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    absolutePath = "";
                }

                fileDtos.Add(new BookFileDto(
                    IdCodec.Encode(f.Id), f.Format.ToString(), f.FileSizeBytes, absolutePath, f.ContentHash,
                    await storage.GetWebViewUrlAsync(f.FilePath, ct)));
            }

            var dto = new BookDetailDto(
                id,
                book.Title,
                book.SortTitle,
                book.Description,
                book.Language,
                book.Publisher,
                book.DatePublished,
                book.Rating,
                book.DateAdded,
                book.PageCount,
                book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                book.BookAuthors.OrderBy(ba => ba.Order).Select(ba =>
                    new AuthorRefDto(
                        IdCodec.Encode(ba.AuthorId), ba.Author.Name, AuthorImageLocator.Find(root, ba.AuthorId) is not null))
                    .ToArray(),
                series?.Series.Name,
                series?.SeriesIndex,
                book.BookTags.Select(bt => bt.Tag.Name).ToArray(),
                book.Identifiers.Select(i => new IdentifierDto(i.Scheme, i.Value)).ToArray(),
                fileDtos.ToArray(),
                CoverLocator.Find(root, book.FolderPath) is not null,
                CoverLocator.GetVersion(root, book.FolderPath),
                book.ReadingStatus.ToString(),
                book.BookCollections
                    .Select(bc => new BookCollectionDto(IdCodec.Encode(bc.CollectionId), bc.Collection.Name))
                    .ToArray(),
                book.PeriodicalId is not null ? IdCodec.Encode(book.PeriodicalId.Value) : null,
                book.Periodical?.Name,
                book.Periodical?.Frequency.ToString(),
                book.IssueNumber,
                book.VolumeNumber,
                book.IssueDate,
                secondsRead,
                expectedTotalSeconds,
                expectedTotalSeconds is { } total ? Math.Max(0, total - secondsRead) : null);

            return Results.Ok(dto);
        });

        group.MapGet("/{id}/cover", async (string id, MaktabaDbContext db, IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var folderPath = await db.Books
                .Where(b => b.Id == bookId)
                .Select(b => b.FolderPath)
                .FirstOrDefaultAsync();

            if (folderPath is null)
            {
                return Results.NotFound();
            }

            var cover = await CoverLocator.FindAsync(storageFactory.Current, folderPath, ct);
            return cover is { } found
                ? Results.File(found.FilePath, found.ContentType)
                : Results.NotFound();
        });

        group.MapGet("/{id}/file", async (string id, string? format, MaktabaDbContext db, IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<BookFormat>(format, ignoreCase: true, out var parsedFormat))
            {
                return Results.BadRequest(new { error = "Invalid or missing format." });
            }

            var file = await db.Books
                .Where(b => b.Id == bookId)
                .SelectMany(b => b.Files)
                .FirstOrDefaultAsync(f => f.Format == parsedFormat, ct);

            if (file is null)
            {
                return Results.NotFound();
            }

            var contentType = parsedFormat switch
            {
                BookFormat.Epub => "application/epub+zip",
                BookFormat.Pdf => "application/pdf",
                BookFormat.Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                BookFormat.Txt => "text/plain",
                _ => "application/octet-stream",
            };

            var localPath = await storageFactory.Current.GetLocalPathAsync(file.FilePath, ct);
            return Results.File(localPath, contentType);
        });

        // Docx/Txt have no reader qari understands natively - ReaderOverlay.tsx feeds this plain
        // text to qari as a Markdown source instead of fetching the raw file like Epub/Pdf do.
        group.MapGet("/{id}/text", async (
            string id, string? format, MaktabaDbContext db, IStorageProviderFactory storageFactory,
            IEnumerable<IBookTextContentExtractor> textExtractors, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<BookFormat>(format, ignoreCase: true, out var parsedFormat))
            {
                return Results.BadRequest(new { error = "Invalid or missing format." });
            }

            var file = await db.Books
                .Where(b => b.Id == bookId)
                .SelectMany(b => b.Files)
                .FirstOrDefaultAsync(f => f.Format == parsedFormat, ct);

            if (file is null)
            {
                return Results.NotFound();
            }

            var absolutePath = await storageFactory.Current.GetLocalPathAsync(file.FilePath, ct);
            var extractor = textExtractors.FirstOrDefault(e => e.CanHandle(absolutePath));
            if (extractor is null)
            {
                return Results.BadRequest(new { error = "This format has no text content extractor." });
            }

            var content = await extractor.ExtractAsync(absolutePath, ct);
            return Results.Text(content, "text/plain");
        });

        group.MapPut("/{id}", async (
            string id, BookEditRequestDto request, IBookEditService editService,
            ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.BadRequest(new { error = "Title is required." });
            }

            // Ids that fail to decode are silently dropped rather than rejected - this is a save
            // operation, not a filter, and a stale/invalid collection id shouldn't block the rest of
            // the edit from going through.
            var collectionIds = request.CollectionIds
                .Select(cid => IdCodec.TryDecode(cid, out var decoded) ? decoded : (int?)null)
                .Where(cid => cid is not null)
                .Select(cid => cid!.Value)
                .ToList();

            // Same "silently drop an unresolvable id" rule as collectionIds above.
            var periodicalId = request.PeriodicalId is not null && IdCodec.TryDecode(request.PeriodicalId, out var decodedPeriodicalId)
                ? decodedPeriodicalId
                : (int?)null;

            var editRequest = new BookEditRequest(
                request.Title.Trim(),
                request.Authors,
                request.Language,
                request.Publisher,
                request.PublishedDate,
                request.Description,
                request.Rating,
                request.SeriesName,
                request.SeriesIndex,
                request.Tags,
                collectionIds,
                periodicalId,
                request.IssueNumber,
                request.VolumeNumber,
                request.IssueDate);

            if (IsNawishtaLibrary(libraryService))
            {
                nawishtaResolver.TryResolve(out var n);
                var updated = await new NawishtaBookMutationService(n.Api, n.RemoteLibraryId, n.Shadow)
                    .UpdateMetadataAsync(bookId, editRequest, ct);
                return updated is null ? Results.NotFound() : Results.NoContent();
            }

            var book = await editService.UpdateAsync(bookId, editRequest, ct);
            return book is null ? Results.NotFound() : Results.NoContent();
        });

        group.MapPatch("/{id}/status", async (
            string id, UpdateBookStatusRequestDto request, MaktabaDbContext db,
            ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<ReadingStatus>(request.ReadingStatus, ignoreCase: true, out var status))
            {
                return Results.BadRequest(new { error = "Invalid reading status." });
            }

            if (IsNawishtaLibrary(libraryService))
            {
                nawishtaResolver.TryResolve(out var n);
                var ok = await new NawishtaBookMutationService(n.Api, n.RemoteLibraryId, n.Shadow).SetReadingStatusAsync(bookId, status, ct);
                return ok ? Results.NoContent() : Results.NotFound();
            }

            var book = await db.Books.FirstOrDefaultAsync(b => b.Id == bookId, ct);
            if (book is null)
            {
                return Results.NotFound();
            }

            book.ReadingStatus = status;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapPost("/{id}/convert", async (
            string id,
            ConvertBookRequestDto request,
            IBookConversionService conversionService,
            IStorageProviderFactory storageFactory,
            CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<BookFormat>(request.TargetFormat, ignoreCase: true, out var targetFormat))
            {
                return Results.BadRequest(new { error = "Invalid target format." });
            }

            var result = await conversionService.ConvertAsync(bookId, targetFormat, ct);

            return result.Outcome switch
            {
                BookConversionOutcome.Converted => Results.Ok(new BookFileDto(
                    IdCodec.Encode(result.File!.Id), result.File.Format.ToString(), result.File.FileSizeBytes,
                    await storageFactory.Current.GetLocalPathAsync(result.File.FilePath, ct), result.File.ContentHash)),
                BookConversionOutcome.BookNotFound => Results.NotFound(),
                BookConversionOutcome.AlreadyHasFormat => Results.Conflict(
                    new { error = $"This book already has a {targetFormat} file." }),
                BookConversionOutcome.CalibreUnavailable => Results.Json(
                    new { error = "Calibre's ebook-convert isn't available on this machine." },
                    statusCode: StatusCodes.Status503ServiceUnavailable),
                _ => Results.Problem(),
            };
        });

        group.MapDelete("/{id}", async (
            string id, IBookRemovalService removalService,
            ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (IsNawishtaLibrary(libraryService))
            {
                nawishtaResolver.TryResolve(out var n);
                var deleted = await new NawishtaBookMutationService(n.Api, n.RemoteLibraryId, n.Shadow).DeleteAsync(bookId, ct);
                return deleted
                    ? Results.Ok(new { folderPath = (string?)null, requiresLocalTrash = false, parentFolderPath = (string?)null })
                    : Results.NotFound();
            }

            var result = await removalService.RemoveAsync(bookId, ct);
            return result is null
                ? Results.NotFound()
                : Results.Ok(new
                {
                    folderPath = result.AbsoluteFolderPath,
                    requiresLocalTrash = result.RequiresLocalTrash,
                    parentFolderPath = result.ParentFolderPath,
                });
        });

        group.MapPost("/{id}/files", async (
            string id,
            AddBookFileRequest request,
            IImportService importService,
            IStorageProviderFactory storageFactory,
            CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            // request.FilePath is a source file the user picked from anywhere on their own disk (via
            // the OS file dialog, see native.ts), not a library-relative path - it's never resolved
            // through IStorageProvider.
            if (string.IsNullOrWhiteSpace(request.FilePath) || !File.Exists(request.FilePath))
            {
                return Results.BadRequest(new { error = "File not found." });
            }

            try
            {
                var book = await importService.AddFileToBookAsync(bookId, request.FilePath, ct);
                if (book is null)
                {
                    return Results.NotFound();
                }

                var addedFile = book.Files[^1];
                var localPath = await storageFactory.Current.GetLocalPathAsync(addedFile.FilePath, ct);
                return Results.Ok(new BookFileDto(
                    IdCodec.Encode(addedFile.Id), addedFile.Format.ToString(), addedFile.FileSizeBytes, localPath, addedFile.ContentHash));
            }
            catch (NotSupportedException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // Issue #27: lets a book's attached file be given an identifiable name (e.g. distinguishing
        // two files of the same format) - the rename is real, on the actual on-disk file, not just a
        // display label, so "Show in folder"/"Open" reflect it too. See BookFolderRelocator's
        // IsCustomNamed check for how this survives a later title/author edit.
        group.MapPatch("/{id}/files/{fileId}/name", async (
            string id, string fileId, RenameBookFileRequestDto request, IBookEditService editService,
            IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || !IdCodec.TryDecode(fileId, out var bookFileId))
            {
                return Results.NotFound();
            }

            var trimmedName = request.FileName?.Trim();
            if (string.IsNullOrEmpty(trimmedName))
            {
                return Results.BadRequest(new { error = "File name is required." });
            }

            var file = await editService.RenameFileAsync(bookId, bookFileId, trimmedName, ct);
            if (file is null)
            {
                return Results.NotFound();
            }

            var localPath = await storageFactory.Current.GetLocalPathAsync(file.FilePath, ct);
            return Results.Ok(new BookFileDto(fileId, file.Format.ToString(), file.FileSizeBytes, localPath, file.ContentHash));
        });

        // Issue #66: re-extracts the cover image embedded in one of the book's own attached files and
        // sets it as the book's cover, overwriting whatever cover is there now.
        group.MapPost("/{id}/files/{fileId}/extract-cover", async (
            string id, string fileId, IBookEditService editService, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || !IdCodec.TryDecode(fileId, out var bookFileId))
            {
                return Results.NotFound();
            }

            var outcome = await editService.ExtractCoverAsync(bookId, bookFileId, ct);
            return outcome switch
            {
                CoverExtractionOutcome.Extracted => Results.NoContent(),
                CoverExtractionOutcome.NoCoverInFile => Results.Conflict(
                    new { error = "This file has no embedded cover image." }),
                _ => Results.NotFound(),
            };
        });

        group.MapDelete("/{id}/files/{fileId}", async (
            string id, string fileId, IBookEditService editService, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || !IdCodec.TryDecode(fileId, out var bookFileId))
            {
                return Results.NotFound();
            }

            try
            {
                var result = await editService.DeleteFileAsync(bookId, bookFileId, ct);
                return result is null ? Results.NotFound() : Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
        });

        // Issue #49: dropping one book onto another (see the frontend's bookDrag.ts) offers to merge
        // them - every file the source has that the target doesn't (by content) moves into the
        // target's folder and the target's own metadata is left untouched. The now-empty source book
        // is left for the caller to delete via the normal DELETE /{id} endpoint once this succeeds,
        // rather than this endpoint doing it itself - keeps "move the files" and "remove the book
        // row + trash its folder" as the same two independently-reusable steps a plain delete uses.
        group.MapPost("/{id}/merge", async (
            string id, MergeBooksRequestDto request, IBookEditService editService, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var targetId) || !IdCodec.TryDecode(request.SourceBookId, out var sourceId))
            {
                return Results.NotFound();
            }

            try
            {
                var merged = await editService.MergeAsync(targetId, sourceId, ct);
                return merged is null ? Results.NotFound() : Results.NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/import", async (
            ImportBookRequest request, IImportService importService, ILibraryService libraryService,
            ILogger<Program> logger, CancellationToken ct) =>
        {
            // Nawishta's content model (chapters/pages/OCR/bind/publish) doesn't map onto "attach an
            // EPUB/PDF file" the way local/S3/Google Drive/OneDrive import does, and needs live
            // verification before it's safe to build (see NawishtaBookMutationService's own doc
            // comment) - a clear, friendly rejection here rather than letting ImportService proceed
            // and fail confusingly partway through against NawishtaStorageProvider's file-write
            // methods, which do throw NotSupportedException but with a less specific message.
            if (IsNawishtaLibrary(libraryService))
            {
                return Results.BadRequest(new
                {
                    error = "Importing files isn't supported yet for a Nawishta-backed library - add books directly on the Nawishta server for now.",
                });
            }

            if (string.IsNullOrWhiteSpace(request.FilePath) || !File.Exists(request.FilePath))
            {
                return Results.BadRequest(new { error = "File not found." });
            }

            var resolution = request.DuplicateAction switch
            {
                "skip" => ImportDuplicateResolution.Skip,
                "keep-both" => ImportDuplicateResolution.KeepBoth,
                "merge" => ImportDuplicateResolution.Merge,
                _ => ImportDuplicateResolution.Auto,
            };

            try
            {
                var book = await importService.ImportFileAsync(request.FilePath, resolution, ct);
                var sqid = IdCodec.Encode(book.Id);
                return Results.Created($"/api/books/{sqid}", new { id = sqid, title = book.Title });
            }
            catch (NotSupportedException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (DuplicateBookDetectedException ex)
            {
                return Results.Conflict(new
                {
                    error = ex.Message,
                    duplicate = new DuplicateBookDto(
                        IdCodec.Encode(ex.ExistingBookId), ex.ExistingTitle, [.. ex.ExistingAuthors], ex.SameContentHash),
                });
            }
            catch (Exception ex)
            {
                // Issue #58: a malformed/unusual ebook file (bad metadata, corrupt zip, etc.) used to
                // bubble up as an unhandled 500 with no actionable message - surfaced as a clear 400
                // instead so the import dialog can show the user what actually went wrong.
                logger.LogWarning(ex, "Failed to import {FilePath}", request.FilePath);
                return Results.BadRequest(new { error = $"Could not import this file: {ex.Message}" });
            }
        });
    }
}
