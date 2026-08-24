using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class PeriodicalService(MaktabaDbContext db, ILibraryPathProvider libraryPath) : IPeriodicalService
{
    public async Task<Periodical> CreateAsync(
        string name, PeriodicalFrequency frequency, string? description, CancellationToken ct = default)
    {
        var libraryRoot = libraryPath.LibraryRootPath!;
        var trimmed = name.Trim();

        var periodical = new Periodical
        {
            Name = trimmed,
            SortName = TitleSorting.ComputeSortTitle(trimmed),
            Frequency = frequency,
            Description = description,
        };

        // Same two-step pattern as ImportService.ImportFileAsync - the on-disk folder embeds the
        // DB-assigned id, so the row has to be inserted first to get it.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.Periodicals.Add(periodical);
        await db.SaveChangesAsync(ct);

        var relativeFolder = Path.Combine(
            "Periodicals", FileNaming.SanitizePathSegment($"{trimmed} ({IdCodec.Encode(periodical.Id)})"));
        var absoluteFolder = Path.Combine(libraryRoot, relativeFolder);

        try
        {
            Directory.CreateDirectory(absoluteFolder);
            periodical.FolderPath = relativeFolder;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return periodical;
        }
        catch
        {
            if (Directory.Exists(absoluteFolder))
            {
                Directory.Delete(absoluteFolder, recursive: true);
            }
            throw;
        }
    }

    public async Task<Periodical?> UpdateAsync(
        int periodicalId, string name, PeriodicalFrequency frequency, string? description, CancellationToken ct = default)
    {
        var periodical = await db.Periodicals
            .Include(p => p.Issues).ThenInclude(b => b.Files)
            .FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
        if (periodical is null)
        {
            return null;
        }

        var trimmed = name.Trim();
        var oldFolderRelative = periodical.FolderPath;
        var newFolderRelative = Path.Combine(
            "Periodicals", FileNaming.SanitizePathSegment($"{trimmed} ({IdCodec.Encode(periodical.Id)})"));

        FolderMoveState? move = null;
        if (!string.Equals(oldFolderRelative, newFolderRelative, StringComparison.Ordinal))
        {
            var libraryRoot = libraryPath.LibraryRootPath!;
            var oldAbsolute = Path.Combine(libraryRoot, oldFolderRelative);
            var newAbsolute = Path.Combine(libraryRoot, newFolderRelative);

            Directory.CreateDirectory(Path.GetDirectoryName(newAbsolute)!);
            Directory.Move(oldAbsolute, newAbsolute);
            move = new FolderMoveState(oldAbsolute, newAbsolute);

            // The periodical's own folder move already brought every nested issue subfolder along
            // with it (Directory.Move on the parent), so only the DB-side path strings - not the
            // files themselves - need updating here, unlike BookFolderRelocator's per-file renames.
            foreach (var issue in periodical.Issues)
            {
                issue.FolderPath = newFolderRelative + issue.FolderPath[oldFolderRelative.Length..];
                foreach (var file in issue.Files)
                {
                    file.FilePath = newFolderRelative + file.FilePath[oldFolderRelative.Length..];
                }
            }

            periodical.FolderPath = newFolderRelative;
        }

        periodical.Name = trimmed;
        periodical.SortName = TitleSorting.ComputeSortTitle(trimmed);
        periodical.Frequency = frequency;
        periodical.Description = description;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            if (move is { } m && Directory.Exists(m.NewAbsolute) && !Directory.Exists(m.OldAbsolute))
            {
                Directory.Move(m.NewAbsolute, m.OldAbsolute);
            }
            throw;
        }

        return periodical;
    }

    public async Task<PeriodicalDeleteOutcome> DeleteAsync(int periodicalId, CancellationToken ct = default)
    {
        var periodical = await db.Periodicals
            .Select(p => new { p.Id, p.FolderPath, IssueCount = p.Issues.Count })
            .FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
        if (periodical is null)
        {
            return PeriodicalDeleteOutcome.NotFound;
        }

        if (periodical.IssueCount > 0)
        {
            return PeriodicalDeleteOutcome.HasIssues;
        }

        await db.Periodicals.Where(p => p.Id == periodicalId).ExecuteDeleteAsync(ct);

        // Unlike a book's folder (routed through the OS trash by the frontend - see BookRemovalService),
        // an issue-less periodical's folder holds at most a cover image, so a direct best-effort
        // delete is fine here rather than adding a second trash round-trip for something this low-value.
        try
        {
            var absoluteFolder = Path.Combine(libraryPath.LibraryRootPath!, periodical.FolderPath);
            if (Directory.Exists(absoluteFolder))
            {
                Directory.Delete(absoluteFolder, recursive: true);
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }

        return PeriodicalDeleteOutcome.Deleted;
    }

    public async Task<Periodical?> SaveCoverAsync(
        int periodicalId, Stream content, string contentType, CancellationToken ct = default)
    {
        var periodical = await db.Periodicals.FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
        if (periodical is null)
        {
            return null;
        }

        var libraryRoot = libraryPath.LibraryRootPath!;
        var absoluteFolder = Path.Combine(libraryRoot, periodical.FolderPath);
        Directory.CreateDirectory(absoluteFolder);

        // Remove any existing cover.* first so replacing a jpg cover with a png (or vice versa)
        // doesn't leave both sitting next to each other - CoverLocator.Find would then keep
        // serving whichever candidate it checks first, regardless of which one was just uploaded.
        foreach (var existing in Directory.EnumerateFiles(absoluteFolder, "cover.*"))
        {
            File.Delete(existing);
        }

        var extension = EbookFileHelpers.CoverExtensionFor(contentType);
        await using (var fileStream = File.Create(Path.Combine(absoluteFolder, $"cover.{extension}")))
        {
            await content.CopyToAsync(fileStream, ct);
        }

        return periodical;
    }

    private readonly record struct FolderMoveState(string OldAbsolute, string NewAbsolute);
}
