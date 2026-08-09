using Maktaba.Api.Dtos;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

/// <summary>Distinct author/series/tag lists (with book counts) for the browse sidebar.</summary>
public static class BrowseEndpoints
{
    public static void MapBrowseEndpoints(this WebApplication app)
    {
        app.MapGet("/api/authors", async (MaktabaDbContext db) =>
        {
            var authors = await db.Authors
                .Where(a => a.BookAuthors.Count > 0)
                .OrderBy(a => a.Name)
                .Select(a => new BrowseGroupDto(a.Id, a.Name, a.BookAuthors.Count))
                .ToListAsync();
            return Results.Ok(authors);
        });

        app.MapGet("/api/series", async (MaktabaDbContext db) =>
        {
            var series = await db.Series
                .Where(s => s.BookSeries.Count > 0)
                .OrderBy(s => s.Name)
                .Select(s => new BrowseGroupDto(s.Id, s.Name, s.BookSeries.Count))
                .ToListAsync();
            return Results.Ok(series);
        });

        app.MapGet("/api/tags", async (MaktabaDbContext db) =>
        {
            var tags = await db.Tags
                .Where(t => t.BookTags.Count > 0)
                .OrderBy(t => t.Name)
                .Select(t => new BrowseGroupDto(t.Id, t.Name, t.BookTags.Count))
                .ToListAsync();
            return Results.Ok(tags);
        });
    }
}
