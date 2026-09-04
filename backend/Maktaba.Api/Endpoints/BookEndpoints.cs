using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class BookEndpoints
{
    // Shared by every endpoint below that builds a BookSummaryDto/ContinueReadingBookDto -
    // AuthorRefDto is the same "name + id + photo presence" shape BookDetailDto already uses for
    // BookDetailPanel's pills, so the Home view/grid rows can reuse it for avatars too.
    private static AuthorRefDto[] BuildAuthorRefs(IEnumerable<BookAuthor> bookAuthors, string root) =>
        bookAuthors
            .OrderBy(ba => ba.Order)
            .Select(ba => new AuthorRefDto(
                IdCodec.Encode(ba.AuthorId), ba.Author.Name, AuthorImageLocator.Find(root, ba.AuthorId) is not null))
            .ToArray();

    public static void MapBookEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books");

        group.MapGet("", async (
            MaktabaDbContext db,
            ILibraryPathProvider libraryPath,
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
            string? language) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var query = db.Books
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
                .Include(b => b.Files)
                .Include(b => b.Periodical)
                .AsNoTracking()
                .AsQueryable();

            // An id that fails to decode can't match anything, so its filter is just left applied with
            // no matching rows below rather than treated as "no filter" - a malformed/stale id should
            // yield an empty result, not silently ignore the filter. "unknown" is a sentinel (not an
            // IdCodec-encoded id, see BrowseEndpoints.cs's /api/authors) matching books with no author
            // at all - see issue #41.
            if (authorId == "unknown")
            {
                query = query.Where(b => !b.BookAuthors.Any());
            }
            else if (authorId is not null)
            {
                var aId = IdCodec.TryDecode(authorId, out var decoded) ? decoded : -1;
                query = query.Where(b => b.BookAuthors.Any(ba => ba.AuthorId == aId));
            }

            if (seriesId is not null)
            {
                var sId = IdCodec.TryDecode(seriesId, out var decoded) ? decoded : -1;
                query = query.Where(b => b.BookSeries.Any(bs => bs.SeriesId == sId));
            }

            if (tagId is not null)
            {
                var tId = IdCodec.TryDecode(tagId, out var decoded) ? decoded : -1;
                query = query.Where(b => b.BookTags.Any(bt => bt.TagId == tId));
            }

            if (collectionId is not null)
            {
                var cId = IdCodec.TryDecode(collectionId, out var decoded) ? decoded : -1;
                query = query.Where(b => b.BookCollections.Any(bc => bc.CollectionId == cId));
            }

            // Issues are hidden from the main library view by default (a daily/weekly periodical
            // would otherwise flood it) - see periodicalSettings.ts's localStorage-backed toggle on
            // the frontend. Browsing a specific periodical always shows its own issues regardless.
            if (periodicalId is not null)
            {
                var pId = IdCodec.TryDecode(periodicalId, out var decoded) ? decoded : -1;
                query = query.Where(b => b.PeriodicalId == pId);
            }
            else if (includeIssues != true)
            {
                query = query.Where(b => b.PeriodicalId == null);
            }

            // Unlike authorId/seriesId/etc., Publisher is a plain string column (see
            // BrowseEndpoints.cs's /api/publishers) - matched directly rather than decoded via IdCodec.
            if (!string.IsNullOrEmpty(publisher))
            {
                query = query.Where(b => b.Publisher == publisher);
            }

            // Same rationale as publisher above - Language is a plain string column (an ISO 639-1
            // code, see BrowseEndpoints.cs's /api/languages/grouped), matched directly.
            if (!string.IsNullOrEmpty(language))
            {
                query = query.Where(b => b.Language == language);
            }

            if (Enum.TryParse<ReadingStatus>(readingStatus, ignoreCase: true, out var parsedStatus))
            {
                query = query.Where(b => b.ReadingStatus == parsedStatus);
            }

            if (minRating is { } rating)
            {
                query = query.Where(b => b.Rating >= rating);
            }

            if (Enum.TryParse<BookFormat>(format, ignoreCase: true, out var parsedFormat))
            {
                query = query.Where(b => b.Files.Any(f => f.Format == parsedFormat));
            }

            var books = await query.ToListAsync();

            // Free-text search runs against the already-materialized list: EF Core can't translate the
            // StringComparison overload of Contains to SQL, and this dataset is small enough (v1: single
            // local library) that in-memory filtering after the SQL-side filters above is simplest.
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                books = books.Where(b =>
                    b.Title.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                    b.BookAuthors.Any(ba => ba.Author.Name.Contains(term, StringComparison.OrdinalIgnoreCase)) ||
                    b.BookSeries.Any(bs => bs.Series.Name.Contains(term, StringComparison.OrdinalIgnoreCase)) ||
                    b.BookTags.Any(bt => bt.Tag.Name.Contains(term, StringComparison.OrdinalIgnoreCase))
                ).ToList();
            }

            // A second small lookup rather than an Include+join above - keeps the main query (with
            // its several optional filters) untouched, and most books never have a progress row.
            var bookIds = books.Select(b => b.Id).ToList();
            var lastReadByBookId = await db.ReadingProgress
                .Where(rp => bookIds.Contains(rp.BookId))
                .ToDictionaryAsync(rp => rp.BookId, rp => rp.UpdatedAt);

            var dtos = books
                .OrderBy(b => b.SortTitle, StringComparer.OrdinalIgnoreCase)
                .Select(b => new BookSummaryDto(
                    IdCodec.Encode(b.Id),
                    b.Title,
                    b.SortTitle,
                    b.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                    BuildAuthorRefs(b.BookAuthors, root),
                    b.Rating,
                    b.DateAdded,
                    CoverLocator.Find(root, b.FolderPath) is not null,
                    b.ReadingStatus.ToString(),
                    b.BookSeries.FirstOrDefault()?.SeriesIndex,
                    b.BookSeries.FirstOrDefault()?.Series.Name,
                    b.BookTags.Select(bt => bt.Tag.Name).ToArray(),
                    b.BookCollections.Select(bc => bc.Collection.Name).ToArray(),
                    lastReadByBookId.TryGetValue(b.Id, out var lastRead) ? lastRead : null,
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

        // Backs the Home view - every book whose ReadingStatus is "Reading", most recently touched
        // first. Starts from Books rather than ReadingProgress (as it used to) because a book can be
        // tagged "Reading" from BookDetailPanel's status dropdown without ever being opened in the
        // reader, so it would never get a ReadingProgress row at all - such a book still belongs
        // here (with 0% progress), it just sorts after ones that actually have progress. The
        // frontend still applies its own ReadingStatus == "Reading" filter defensively, but every
        // row from here now already satisfies it.
        group.MapGet("/continue-reading", async (
            MaktabaDbContext db, ILibraryPathProvider libraryPath, int? limit, bool? includeIssues) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var query = db.Books
                .Where(b => b.ReadingStatus == ReadingStatus.Reading)
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(b => b.Files)
                .AsNoTracking()
                .AsQueryable();

            if (includeIssues != true)
            {
                query = query.Where(b => b.PeriodicalId == null);
            }

            var books = await query.ToListAsync();
            var bookIds = books.Select(b => b.Id).ToList();
            var progressByBookId = await db.ReadingProgress
                .Where(rp => bookIds.Contains(rp.BookId))
                .ToDictionaryAsync(rp => rp.BookId);

            var dtos = books
                .Select(book =>
                {
                    var progress = progressByBookId.GetValueOrDefault(book.Id);
                    // Same "prefer Epub" rule BookDetailPanel/openReader uses on the frontend - the
                    // resume button opens whichever format this feed reports without a second round trip.
                    var file = book.Files.FirstOrDefault(f => f.Format == BookFormat.Epub) ?? book.Files.FirstOrDefault();

                    return new ContinueReadingBookDto(
                        IdCodec.Encode(book.Id),
                        book.Title,
                        book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                        BuildAuthorRefs(book.BookAuthors, root),
                        CoverLocator.Find(root, book.FolderPath) is not null,
                        book.ReadingStatus.ToString(),
                        (file?.Format ?? BookFormat.Epub).ToString(),
                        file is not null ? Path.Combine(root, file.FilePath) : "",
                        progress?.Percentage ?? 0,
                        progress?.UpdatedAt ?? book.DateAdded);
                })
                .OrderByDescending(dto => dto.UpdatedAt)
                .Take(limit is > 0 ? limit.Value : 20)
                .ToList();

            return Results.Ok(dtos);
        });

        // Backs the Home view's "Recently Added" shelf - the newest books by DateAdded, regardless of
        // reading progress. Deliberately separate from /continue-reading: that feed only includes
        // books with a ReadingProgress row, so a freshly imported library (nothing opened yet) would
        // show nothing there even though there's plenty to display here.
        group.MapGet("/recently-added", async (
            MaktabaDbContext db, ILibraryPathProvider libraryPath, int? limit, bool? includeIssues) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var query = db.Books
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
                .Include(b => b.Files)
                .Include(b => b.Periodical)
                .AsNoTracking()
                .AsQueryable();

            if (includeIssues != true)
            {
                query = query.Where(b => b.PeriodicalId == null);
            }

            var books = await query
                .OrderByDescending(b => b.DateAdded)
                .Take(limit is > 0 ? limit.Value : 12)
                .ToListAsync();

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

        group.MapGet("/{id}", async (string id, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var root = libraryPath.LibraryRootPath!;

            var book = await db.Books
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .Include(b => b.BookCollections).ThenInclude(bc => bc.Collection)
                .Include(b => b.Files)
                .Include(b => b.Identifiers)
                .Include(b => b.Periodical)
                .AsNoTracking()
                .FirstOrDefaultAsync(b => b.Id == bookId);

            if (book is null)
            {
                return Results.NotFound();
            }

            var series = book.BookSeries.FirstOrDefault();

            var secondsRead = await db.ReadingActivities.Where(ra => ra.BookId == bookId).SumAsync(ra => (int?)ra.DurationSeconds, default) ?? 0;
            var percentage = await db.ReadingProgress.Where(rp => rp.BookId == bookId).Select(rp => (double?)rp.Percentage).FirstOrDefaultAsync();
            var expectedTotalSeconds = ReadingTimeEstimator.EstimateTotalSeconds(secondsRead, percentage ?? 0);

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
                book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                book.BookAuthors.OrderBy(ba => ba.Order).Select(ba =>
                    new AuthorRefDto(
                        IdCodec.Encode(ba.AuthorId), ba.Author.Name, AuthorImageLocator.Find(root, ba.AuthorId) is not null))
                    .ToArray(),
                series?.Series.Name,
                series?.SeriesIndex,
                book.BookTags.Select(bt => bt.Tag.Name).ToArray(),
                book.Identifiers.Select(i => new IdentifierDto(i.Scheme, i.Value)).ToArray(),
                book.Files.Select(f => new BookFileDto(
                    IdCodec.Encode(f.Id), f.Format.ToString(), f.FileSizeBytes, Path.Combine(root, f.FilePath), f.ContentHash)).ToArray(),
                CoverLocator.Find(root, book.FolderPath) is not null,
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

        group.MapGet("/{id}/cover", async (string id, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var root = libraryPath.LibraryRootPath!;

            var folderPath = await db.Books
                .Where(b => b.Id == bookId)
                .Select(b => b.FolderPath)
                .FirstOrDefaultAsync();

            if (folderPath is null)
            {
                return Results.NotFound();
            }

            var cover = CoverLocator.Find(root, folderPath);
            return cover is { } found
                ? Results.File(found.FilePath, found.ContentType)
                : Results.NotFound();
        });

        group.MapGet("/{id}/file", async (string id, string? format, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<BookFormat>(format, ignoreCase: true, out var parsedFormat))
            {
                return Results.BadRequest(new { error = "Invalid or missing format." });
            }

            var root = libraryPath.LibraryRootPath!;

            var file = await db.Books
                .Where(b => b.Id == bookId)
                .SelectMany(b => b.Files)
                .FirstOrDefaultAsync(f => f.Format == parsedFormat);

            if (file is null)
            {
                return Results.NotFound();
            }

            var contentType = parsedFormat switch
            {
                BookFormat.Epub => "application/epub+zip",
                BookFormat.Pdf => "application/pdf",
                _ => "application/octet-stream",
            };

            return Results.File(Path.Combine(root, file.FilePath), contentType);
        });

        group.MapPut("/{id}", async (
            string id, BookEditRequestDto request, IBookEditService editService, CancellationToken ct) =>
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

            var book = await editService.UpdateAsync(bookId, editRequest, ct);
            return book is null ? Results.NotFound() : Results.NoContent();
        });

        group.MapPatch("/{id}/status", async (
            string id, UpdateBookStatusRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (!Enum.TryParse<ReadingStatus>(request.ReadingStatus, ignoreCase: true, out var status))
            {
                return Results.BadRequest(new { error = "Invalid reading status." });
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
            ILibraryPathProvider libraryPath,
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
            var root = libraryPath.LibraryRootPath!;

            return result.Outcome switch
            {
                BookConversionOutcome.Converted => Results.Ok(new BookFileDto(
                    IdCodec.Encode(result.File!.Id), result.File.Format.ToString(), result.File.FileSizeBytes, Path.Combine(root, result.File.FilePath), result.File.ContentHash)),
                BookConversionOutcome.BookNotFound => Results.NotFound(),
                BookConversionOutcome.AlreadyHasFormat => Results.Conflict(
                    new { error = $"This book already has a {targetFormat} file." }),
                BookConversionOutcome.CalibreUnavailable => Results.Json(
                    new { error = "Calibre's ebook-convert isn't available on this machine." },
                    statusCode: StatusCodes.Status503ServiceUnavailable),
                _ => Results.Problem(),
            };
        });

        group.MapDelete("/{id}", async (string id, IBookRemovalService removalService, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var result = await removalService.RemoveAsync(bookId, ct);
            return result is null ? Results.NotFound() : Results.Ok(new { folderPath = result.AbsoluteFolderPath });
        });

        group.MapPost("/{id}/files", async (
            string id,
            AddBookFileRequest request,
            IImportService importService,
            ILibraryPathProvider libraryPath,
            CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

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
                var root = libraryPath.LibraryRootPath!;
                return Results.Ok(new BookFileDto(
                    IdCodec.Encode(addedFile.Id), addedFile.Format.ToString(), addedFile.FileSizeBytes, Path.Combine(root, addedFile.FilePath), addedFile.ContentHash));
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
            ILibraryPathProvider libraryPath, CancellationToken ct) =>
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

            var root = libraryPath.LibraryRootPath!;
            return Results.Ok(new BookFileDto(fileId, file.Format.ToString(), file.FileSizeBytes, Path.Combine(root, file.FilePath)));
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
            ImportBookRequest request, IImportService importService, ILogger<Program> logger, CancellationToken ct) =>
        {
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
