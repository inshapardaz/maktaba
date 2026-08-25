using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class PeriodicalEndpoints
{
    public static void MapPeriodicalEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/periodicals");

        group.MapGet("", async (MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            var root = libraryPath.LibraryRootPath!;

            var periodicals = await db.Periodicals
                .OrderBy(p => p.SortName)
                .Select(p => new { p.Id, p.Name, p.Description, p.Frequency, p.Language, p.FolderPath, IssueCount = p.Issues.Count })
                .ToListAsync();

            return Results.Ok(periodicals.Select(p => new PeriodicalDto(
                IdCodec.Encode(p.Id),
                p.Name,
                p.Description,
                p.Frequency.ToString(),
                p.Language,
                p.IssueCount,
                CoverLocator.Find(root, p.FolderPath) is not null)));
        });

        group.MapPost("", async (
            CreatePeriodicalRequestDto request, MaktabaDbContext db, IPeriodicalService periodicalService,
            ILibraryPathProvider libraryPath, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            if (!Enum.TryParse<PeriodicalFrequency>(request.Frequency, ignoreCase: true, out var frequency))
            {
                return Results.BadRequest(new { error = "Invalid frequency." });
            }

            // Same "create is really upsert-by-name" semantics as CollectionEndpoints - a repeated
            // quick-add of the same periodical name (e.g. from the sidebar) resolves to the one
            // existing row instead of creating a duplicate.
            var root = libraryPath.LibraryRootPath!;
            var existing = await db.Periodicals
                .Where(p => p.Name.ToLower() == name.ToLower())
                .Select(p => new { p.Id, p.Name, p.Description, p.Frequency, p.Language, p.FolderPath, IssueCount = p.Issues.Count })
                .FirstOrDefaultAsync(ct);

            if (existing is not null)
            {
                return Results.Ok(new PeriodicalDto(
                    IdCodec.Encode(existing.Id), existing.Name, existing.Description, existing.Frequency.ToString(),
                    existing.Language, existing.IssueCount, CoverLocator.Find(root, existing.FolderPath) is not null));
            }

            var periodical = await periodicalService.CreateAsync(name, frequency, request.Description?.Trim(), request.Language?.Trim(), ct);
            var dto = new PeriodicalDto(
                IdCodec.Encode(periodical.Id), periodical.Name, periodical.Description, periodical.Frequency.ToString(),
                periodical.Language, 0, false);
            return Results.Created($"/api/periodicals/{dto.Id}", dto);
        });

        group.MapGet("/{id}", async (string id, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var periodicalId))
            {
                return Results.NotFound();
            }

            var root = libraryPath.LibraryRootPath!;

            var periodical = await db.Periodicals
                .Where(p => p.Id == periodicalId)
                .Select(p => new { p.Id, p.Name, p.Description, p.Frequency, p.Language, p.FolderPath, IssueCount = p.Issues.Count })
                .FirstOrDefaultAsync();

            if (periodical is null)
            {
                return Results.NotFound();
            }

            return Results.Ok(new PeriodicalDto(
                IdCodec.Encode(periodical.Id), periodical.Name, periodical.Description, periodical.Frequency.ToString(),
                periodical.Language, periodical.IssueCount, CoverLocator.Find(root, periodical.FolderPath) is not null));
        });

        group.MapPut("/{id}", async (
            string id, UpdatePeriodicalRequestDto request, IPeriodicalService periodicalService,
            ILibraryPathProvider libraryPath, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var periodicalId))
            {
                return Results.NotFound();
            }

            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            if (!Enum.TryParse<PeriodicalFrequency>(request.Frequency, ignoreCase: true, out var frequency))
            {
                return Results.BadRequest(new { error = "Invalid frequency." });
            }

            var periodical = await periodicalService.UpdateAsync(
                periodicalId, name, frequency, request.Description?.Trim(), request.Language?.Trim(), ct);
            if (periodical is null)
            {
                return Results.NotFound();
            }

            var root = libraryPath.LibraryRootPath!;
            return Results.Ok(new PeriodicalDto(
                IdCodec.Encode(periodical.Id), periodical.Name, periodical.Description, periodical.Frequency.ToString(),
                periodical.Language, periodical.Issues.Count, CoverLocator.Find(root, periodical.FolderPath) is not null));
        });

        group.MapDelete("/{id}", async (string id, IPeriodicalService periodicalService, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var periodicalId))
            {
                return Results.NotFound();
            }

            var outcome = await periodicalService.DeleteAsync(periodicalId, ct);
            return outcome switch
            {
                PeriodicalDeleteOutcome.Deleted => Results.NoContent(),
                PeriodicalDeleteOutcome.NotFound => Results.NotFound(),
                PeriodicalDeleteOutcome.HasIssues => Results.Conflict(
                    new { error = "This periodical still has issues. Move or remove them first." }),
                _ => Results.Problem(),
            };
        });

        group.MapGet("/{id}/cover", async (string id, MaktabaDbContext db, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var periodicalId))
            {
                return Results.NotFound();
            }

            var root = libraryPath.LibraryRootPath!;

            var folderPath = await db.Periodicals
                .Where(p => p.Id == periodicalId)
                .Select(p => p.FolderPath)
                .FirstOrDefaultAsync();

            if (folderPath is null)
            {
                return Results.NotFound();
            }

            var cover = CoverLocator.Find(root, folderPath);
            return cover is { } found ? Results.File(found.FilePath, found.ContentType) : Results.NotFound();
        });

        group.MapPost("/{id}/cover", async (string id, IFormFile file, IPeriodicalService periodicalService, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var periodicalId))
            {
                return Results.NotFound();
            }

            if (file.Length == 0 || (file.ContentType != "image/jpeg" && file.ContentType != "image/png"))
            {
                return Results.BadRequest(new { error = "Cover must be a JPEG or PNG image." });
            }

            await using var stream = file.OpenReadStream();
            var periodical = await periodicalService.SaveCoverAsync(periodicalId, stream, file.ContentType, ct);
            return periodical is null ? Results.NotFound() : Results.NoContent();
        }).DisableAntiforgery();
    }
}
