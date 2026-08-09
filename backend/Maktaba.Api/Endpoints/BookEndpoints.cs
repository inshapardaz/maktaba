using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
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
            Guid? authorId,
            Guid? seriesId,
            Guid? tagId,
            string? format,
            int? minRating) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var query = db.Books
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .Include(b => b.Files)
                .AsNoTracking()
                .AsQueryable();

            if (authorId is { } aId)
            {
                query = query.Where(b => b.BookAuthors.Any(ba => ba.AuthorId == aId));
            }

            if (seriesId is { } sId)
            {
                query = query.Where(b => b.BookSeries.Any(bs => bs.SeriesId == sId));
            }

            if (tagId is { } tId)
            {
                query = query.Where(b => b.BookTags.Any(bt => bt.TagId == tId));
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

            var dtos = books
                .OrderBy(b => b.SortTitle, StringComparer.OrdinalIgnoreCase)
                .Select(b => new BookSummaryDto(
                    b.Id,
                    b.Title,
                    b.SortTitle,
                    b.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                    b.Rating,
                    b.DateAdded,
                    CoverLocator.Find(root, b.FolderPath) is not null))
                .ToList();

            return Results.Ok(dtos);
        });

        group.MapGet("/{id:guid}", async (Guid id, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var book = await db.Books
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .Include(b => b.BookSeries).ThenInclude(bs => bs.Series)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .Include(b => b.Files)
                .Include(b => b.Identifiers)
                .AsNoTracking()
                .FirstOrDefaultAsync(b => b.Id == id);

            if (book is null)
            {
                return Results.NotFound();
            }

            var series = book.BookSeries.FirstOrDefault();

            var dto = new BookDetailDto(
                book.Id,
                book.Title,
                book.SortTitle,
                book.Description,
                book.Language,
                book.Publisher,
                book.DatePublished,
                book.Rating,
                book.DateAdded,
                book.BookAuthors.OrderBy(ba => ba.Order).Select(ba => ba.Author.Name).ToArray(),
                series?.Series.Name,
                series?.SeriesIndex,
                book.BookTags.Select(bt => bt.Tag.Name).ToArray(),
                book.Identifiers.Select(i => new IdentifierDto(i.Scheme, i.Value)).ToArray(),
                book.Files.Select(f => new BookFileDto(
                    f.Format.ToString(), f.FileSizeBytes, Path.Combine(root, f.FilePath))).ToArray(),
                CoverLocator.Find(root, book.FolderPath) is not null);

            return Results.Ok(dto);
        });

        group.MapGet("/{id:guid}/cover", async (Guid id, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var folderPath = await db.Books
                .Where(b => b.Id == id)
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

        group.MapPut("/{id:guid}", async (
            Guid id, BookEditRequestDto request, IBookEditService editService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return Results.BadRequest(new { error = "Title is required." });
            }

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
                request.Tags);

            var book = await editService.UpdateAsync(id, editRequest, ct);
            return book is null ? Results.NotFound() : Results.NoContent();
        });

        group.MapDelete("/{id:guid}", async (Guid id, IBookRemovalService removalService, CancellationToken ct) =>
        {
            var result = await removalService.RemoveAsync(id, ct);
            return result is null ? Results.NotFound() : Results.Ok(new { folderPath = result.AbsoluteFolderPath });
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
                return Results.Created($"/api/books/{book.Id}", new { id = book.Id });
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
                    duplicate = new DuplicateBookDto(ex.ExistingBookId, ex.ExistingTitle, [.. ex.ExistingAuthors], ex.SameContentHash),
                });
            }
        });
    }
}
