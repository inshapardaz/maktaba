using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class BookEndpoints
{
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
                .Include(b => b.Files)
                .Include(b => b.Periodical)
                .AsNoTracking()
                .AsQueryable();

            // An id that fails to decode can't match anything, so its filter is just left applied with
            // no matching rows below rather than treated as "no filter" - a malformed/stale id should
            // yield an empty result, not silently ignore the filter.
            if (authorId is not null)
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
                    b.Rating,
                    b.DateAdded,
                    CoverLocator.Find(root, b.FolderPath) is not null,
                    b.ReadingStatus.ToString(),
                    b.BookSeries.FirstOrDefault()?.SeriesIndex,
                    lastReadByBookId.TryGetValue(b.Id, out var lastRead) ? lastRead : null,
                    b.Files.Select(f => f.Format.ToString()).Distinct().ToArray(),
                    b.PeriodicalId is not null ? IdCodec.Encode(b.PeriodicalId.Value) : null,
                    b.Periodical?.Name,
                    b.IssueNumber,
                    b.VolumeNumber,
                    b.IssueDate))
                .ToList();

            return Results.Ok(dtos);
        });

        // Backs the Home view - every book that has a ReadingProgress row (i.e. was opened in the
        // reader at least once), most recently updated first. The frontend takes items[0] as "last
        // read" and filters ReadingStatus == "Reading" for the "currently reading" list, rather
        // than this endpoint exposing two separate shapes for what's really one ordered feed.
        group.MapGet("/continue-reading", async (
            MaktabaDbContext db, ILibraryPathProvider libraryPath, int? limit, bool? includeIssues) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var query = db.ReadingProgress
                .Include(rp => rp.Book).ThenInclude(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(rp => rp.Book).ThenInclude(b => b.Files)
                .AsNoTracking()
                .AsQueryable();

            if (includeIssues != true)
            {
                query = query.Where(rp => rp.Book.PeriodicalId == null);
            }

            var rows = await query
                .OrderByDescending(rp => rp.UpdatedAt)
                .Take(limit is > 0 ? limit.Value : 20)
                .ToListAsync();

            var dtos = rows.Select(rp =>
            {
                var book = rp.Book;
                // Same "prefer Epub" rule BookDetailPanel/openReader uses on the frontend - the resume
                // button opens whichever format this feed reports without a second round trip.
                var file = book.Files.FirstOrDefault(f => f.Format == BookFormat.Epub) ?? book.Files.FirstOrDefault();

                return new ContinueReadingBookDto(
                    IdCodec.Encode(book.Id),
                    book.Title,
                    book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                    CoverLocator.Find(root, book.FolderPath) is not null,
                    book.ReadingStatus.ToString(),
                    (file?.Format ?? BookFormat.Epub).ToString(),
                    file is not null ? Path.Combine(root, file.FilePath) : "",
                    rp.Percentage,
                    rp.UpdatedAt);
            }).ToList();

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
                    b.Rating,
                    b.DateAdded,
                    CoverLocator.Find(root, b.FolderPath) is not null,
                    b.ReadingStatus.ToString(),
                    null,
                    null,
                    b.Files.Select(f => f.Format.ToString()).Distinct().ToArray(),
                    b.PeriodicalId is not null ? IdCodec.Encode(b.PeriodicalId.Value) : null,
                    b.Periodical?.Name,
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
                    f.Format.ToString(), f.FileSizeBytes, Path.Combine(root, f.FilePath))).ToArray(),
                CoverLocator.Find(root, book.FolderPath) is not null,
                book.ReadingStatus.ToString(),
                book.BookCollections
                    .Select(bc => new BookCollectionDto(IdCodec.Encode(bc.CollectionId), bc.Collection.Name))
                    .ToArray(),
                book.PeriodicalId is not null ? IdCodec.Encode(book.PeriodicalId.Value) : null,
                book.Periodical?.Name,
                book.IssueNumber,
                book.VolumeNumber,
                book.IssueDate);

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
                    result.File!.Format.ToString(), result.File.FileSizeBytes, Path.Combine(root, result.File.FilePath))),
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
                    addedFile.Format.ToString(), addedFile.FileSizeBytes, Path.Combine(root, addedFile.FilePath)));
            }
            catch (NotSupportedException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        group.MapPost("/import", async (ImportBookRequest request, IImportService importService, CancellationToken ct) =>
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
        });
    }
}
