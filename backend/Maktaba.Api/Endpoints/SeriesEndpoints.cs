using Maktaba.Api.Dtos;
using Maktaba.Core.Ids;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class SeriesEndpoints
{
    public static void MapSeriesEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/series");

        // Cascades to every book in this series automatically - BookSeries rows reference the
        // Series by id, so renaming the Series row is all that's needed (unlike authors, series
        // have no on-disk folder implications).
        group.MapPut("/{id}/name", async (string id, RenameSeriesRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            if (!IdCodec.TryDecode(id, out var seriesId))
            {
                return Results.NotFound();
            }

            var series = await db.Series.FirstOrDefaultAsync(s => s.Id == seriesId, ct);
            if (series is null)
            {
                return Results.NotFound();
            }

            // Excludes the series' own row, so renaming to a different case/whitespace variant of
            // its own existing name (a "fix the casing" rename) isn't treated as a collision.
            var collision = await db.Series.AnyAsync(s => s.Id != seriesId && s.Name.ToLower() == name.ToLower(), ct);
            if (collision)
            {
                return Results.Conflict(new { error = $"A series named \"{name}\" already exists." });
            }

            series.Name = name;
            var bookCount = await db.BookSeries.CountAsync(bs => bs.SeriesId == seriesId, ct);
            await db.SaveChangesAsync(ct);

            return Results.Ok(new BrowseGroupDto(IdCodec.Encode(series.Id), series.Name, bookCount));
        });
    }
}
