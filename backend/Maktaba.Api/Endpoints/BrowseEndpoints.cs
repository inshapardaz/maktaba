using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

/// <summary>Distinct author/series/tag/language lists (with book counts) for the browse sidebar,
/// plus a bare publisher-name list for the book-edit form's autocomplete.</summary>
public static class BrowseEndpoints
{
    public static void MapBrowseEndpoints(this WebApplication app)
    {
        app.MapGet("/api/authors", async (MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            // IdCodec.Encode can't be translated to SQL, so the raw int id is projected first and
            // encoded afterwards, in memory.
            var authors = await db.Authors
                .Where(a => a.BookAuthors.Count > 0)
                .OrderBy(a => a.Name)
                .Select(a => new { a.Id, a.Name, Count = a.BookAuthors.Count })
                .ToListAsync();

            var root = libraryPath.LibraryRootPath!;
            var result = authors.Select(a => new BrowseGroupDto(
                IdCodec.Encode(a.Id), a.Name, a.Count, AuthorImageLocator.Find(root, a.Id) is not null)).ToList();

            // Issue #41: a book can have zero authors (import falls back to "Unknown Author" for the
            // folder name only, see ImportService.cs - the Author entity/row is never created for it).
            // Those books are otherwise unreachable from this sidebar list since it only enumerates
            // rows in the Authors table, so a sentinel "unknown" group (matched directly in
            // BookEndpoints.cs's authorId filter, not via IdCodec) is appended when any exist.
            var unknownCount = await db.Books.CountAsync(b => !b.BookAuthors.Any());
            if (unknownCount > 0)
            {
                result.Add(new BrowseGroupDto("unknown", "", unknownCount));
            }

            return Results.Ok(result);
        });

        app.MapGet("/api/series", async (MaktabaDbContext db) =>
        {
            var series = await db.Series
                .Where(s => s.BookSeries.Count > 0)
                .OrderBy(s => s.Name)
                .Select(s => new { s.Id, s.Name, Count = s.BookSeries.Count })
                .ToListAsync();
            return Results.Ok(series.Select(s => new BrowseGroupDto(IdCodec.Encode(s.Id), s.Name, s.Count)));
        });

        app.MapGet("/api/tags", async (MaktabaDbContext db) =>
        {
            var tags = await db.Tags
                .Where(t => t.BookTags.Count > 0)
                .OrderBy(t => t.Name)
                .Select(t => new { t.Id, t.Name, Count = t.BookTags.Count })
                .ToListAsync();
            return Results.Ok(tags.Select(t => new BrowseGroupDto(IdCodec.Encode(t.Id), t.Name, t.Count)));
        });

        // Distinct publisher names already in the library, for the book-edit form's publisher
        // autocomplete - unlike Authors/Series/Tags, Publisher is a plain string field on Book
        // (find-or-create only in the loose sense of "suggest a match", never its own entity/table),
        // so this returns bare strings rather than BrowseGroupDto with an id/count.
        app.MapGet("/api/publishers", async (MaktabaDbContext db) =>
        {
            var publishers = await db.Books
                .Where(b => b.Publisher != null && b.Publisher != "")
                .Select(b => b.Publisher!)
                .Distinct()
                .OrderBy(p => p)
                .ToListAsync();
            return Results.Ok(publishers);
        });

        // Distinct publishers with book counts, for the sidebar's "browse by publisher" section -
        // same shape as authors/series/tags above so the frontend can treat it as just another
        // BrowseGroup, but grouped straight off the string column rather than a join table. The
        // publisher name itself doubles as the "id" (there's no int primary key to encode/decode),
        // which is why /api/books' publisher filter matches it directly rather than via IdCodec.
        app.MapGet("/api/publishers/grouped", async (MaktabaDbContext db) =>
        {
            var publishers = await db.Books
                .Where(b => b.Publisher != null && b.Publisher != "")
                .GroupBy(b => b.Publisher!)
                .Select(g => new { Name = g.Key, Count = g.Count() })
                .OrderBy(p => p.Name)
                .ToListAsync();
            return Results.Ok(publishers.Select(p => new BrowseGroupDto(p.Name, p.Name, p.Count)));
        });

        // Distinct book languages with book counts, for the sidebar's "browse by language" section
        // (issue #13) - same shape/rationale as the publisher grouping just above: Language is a
        // plain string column on Book (an ISO 639-1 code, see BookEditForm.tsx's LANGUAGE_CODES),
        // not its own entity/table, so the code itself doubles as the BrowseGroup "id" and the
        // frontend translates it to a display name (language.<code> i18n keys) for rendering.
        app.MapGet("/api/languages/grouped", async (MaktabaDbContext db) =>
        {
            var languages = await db.Books
                .Where(b => b.Language != null && b.Language != "")
                .GroupBy(b => b.Language!)
                .Select(g => new { Name = g.Key, Count = g.Count() })
                .OrderBy(l => l.Name)
                .ToListAsync();
            return Results.Ok(languages.Select(l => new BrowseGroupDto(l.Name, l.Name, l.Count)));
        });

        app.MapGet("/api/reading-statuses", async (MaktabaDbContext db) =>
        {
            var counts = await db.Books
                .GroupBy(b => b.ReadingStatus)
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToListAsync();

            // Every status is always returned, even with a zero count, so the sidebar can render a
            // stable Unread/Reading/Finished list without special-casing missing entries.
            var byStatus = counts.ToDictionary(c => c.Status, c => c.Count);
            var all = Enum.GetValues<ReadingStatus>()
                .Select(status => new ReadingStatusCountDto(status.ToString(), byStatus.GetValueOrDefault(status)));

            return Results.Ok(all);
        });
    }
}
