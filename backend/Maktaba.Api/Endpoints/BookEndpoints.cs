using Maktaba.Api.Dtos;
using Maktaba.Core.Services;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class BookEndpoints
{
    public static void MapBookEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books");

        group.MapGet("", async (MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var books = await db.Books
                .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
                .AsNoTracking()
                .ToListAsync();

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

        group.MapPost("/import", async (ImportBookRequest request, IImportService importService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.FilePath) || !File.Exists(request.FilePath))
            {
                return Results.BadRequest(new { error = "File not found." });
            }

            try
            {
                var book = await importService.ImportFileAsync(request.FilePath, ct);
                return Results.Created($"/api/books/{book.Id}", new { id = book.Id });
            }
            catch (NotSupportedException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });
    }
}
