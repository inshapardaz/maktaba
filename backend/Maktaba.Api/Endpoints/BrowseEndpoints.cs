using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

/// <summary>Distinct author/series/tag lists (with book counts) for the browse sidebar, plus a bare
/// publisher-name list for the book-edit form's autocomplete.</summary>
public static class BrowseEndpoints
{
    public static void MapBrowseEndpoints(this WebApplication app)
    {
        app.MapGet("/api/authors", async (MaktabaDbContext db) =>
        {
            // IdCodec.Encode can't be translated to SQL, so the raw int id is projected first and
            // encoded afterwards, in memory.
            var authors = await db.Authors
                .Where(a => a.BookAuthors.Count > 0)
                .OrderBy(a => a.Name)
                .Select(a => new { a.Id, a.Name, Count = a.BookAuthors.Count })
                .ToListAsync();
            return Results.Ok(authors.Select(a => new BrowseGroupDto(IdCodec.Encode(a.Id), a.Name, a.Count)));
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
