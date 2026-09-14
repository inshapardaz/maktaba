using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Maktaba.Data.Services;

public class PeriodicalService(
    MaktabaDbContext db, IStorageProviderFactory storageFactory, ILogger<PeriodicalService> logger) : IPeriodicalService
{
    private IStorageProvider Storage => storageFactory.Current;

    public async Task<Periodical> CreateAsync(PeriodicalEditRequest request, CancellationToken ct = default)
    {
        var trimmed = request.Name.Trim();

        var periodical = new Periodical
        {
            Name = trimmed,
            SortName = TitleSorting.ComputeSortTitle(trimmed),
            Frequency = request.Frequency,
            Description = request.Description,
            Language = request.Language,
            Publisher = request.Publisher,
            Editor = request.Editor,
        };

        var tags = await EntityResolvers.ResolveTagsAsync(db, request.Tags, ct);
        foreach (var tag in tags)
        {
            periodical.PeriodicalTags.Add(new PeriodicalTag { Periodical = periodical, Tag = tag });
        }

        // Same two-step pattern as ImportService.ImportFileAsync - the on-disk folder embeds the
        // DB-assigned id, so the row has to be inserted first to get it.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.Periodicals.Add(periodical);
        await db.SaveChangesAsync(ct);

        var relativeFolder = LibraryPathBuilder.PeriodicalFolderPath(trimmed, periodical.Id);

        try
        {
            await Storage.CreateDirectoryAsync(relativeFolder, ct);
            periodical.FolderPath = relativeFolder;
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            return periodical;
        }
        catch
        {
            if (await Storage.ExistsAsync(relativeFolder, ct))
            {
                await Storage.DeleteAsync(relativeFolder, recursive: true, ct);
            }
            throw;
        }
    }

    public async Task<Periodical?> UpdateAsync(int periodicalId, PeriodicalEditRequest request, CancellationToken ct = default)
    {
        var periodical = await db.Periodicals
            .Include(p => p.Issues).ThenInclude(b => b.Files)
            .Include(p => p.PeriodicalTags).ThenInclude(pt => pt.Tag)
            .FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
        if (periodical is null)
        {
            return null;
        }

        var trimmed = request.Name.Trim();
        var oldFolderRelative = periodical.FolderPath;
        var newFolderRelative = LibraryPathBuilder.PeriodicalFolderPath(trimmed, periodical.Id);

        FolderMoveState? move = null;
        if (!string.Equals(oldFolderRelative, newFolderRelative, StringComparison.Ordinal))
        {
            await Storage.MoveAsync(oldFolderRelative, newFolderRelative, ct);
            move = new FolderMoveState(oldFolderRelative, newFolderRelative);

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
        periodical.Frequency = request.Frequency;
        periodical.Description = request.Description;
        periodical.Language = request.Language;
        periodical.Publisher = request.Publisher;
        periodical.Editor = request.Editor;

        db.PeriodicalTags.RemoveRange(periodical.PeriodicalTags);
        periodical.PeriodicalTags.Clear();
        var tags = await EntityResolvers.ResolveTagsAsync(db, request.Tags, ct);
        foreach (var tag in tags)
        {
            periodical.PeriodicalTags.Add(new PeriodicalTag { PeriodicalId = periodical.Id, Tag = tag });
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            if (move is { } m &&
                await Storage.ExistsAsync(m.NewRelative, ct) &&
                !await Storage.ExistsAsync(m.OldRelative, ct))
            {
                await Storage.MoveAsync(m.NewRelative, m.OldRelative, ct);
            }
            throw;
        }

        return periodical;
    }

    public async Task<PeriodicalDeleteResult> DeleteAsync(int periodicalId, bool deleteIssues, CancellationToken ct = default)
    {
        var periodical = await db.Periodicals
            .Include(p => p.Issues)
            .FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
        if (periodical is null)
        {
            return new PeriodicalDeleteResult(PeriodicalDeleteOutcome.NotFound);
        }

        if (periodical.Issues.Count > 0 && !deleteIssues)
        {
            return new PeriodicalDeleteResult(PeriodicalDeleteOutcome.HasIssues);
        }

        var absoluteFolder = await Storage.GetLocalPathAsync(periodical.FolderPath, ct);

        // A cloud-backed library has no OS trash to defer to - see BookRemovalService's identical
        // reasoning. Best-effort: doesn't block removing the DB rows below on a failed remote
        // delete.
        var requiresLocalTrash = Storage.ProviderType == "local";
        if (!requiresLocalTrash)
        {
            try
            {
                await Storage.DeleteAsync(periodical.FolderPath, recursive: true, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to delete periodical folder \"{FolderPath}\" from the cloud provider.", periodical.FolderPath);
            }
        }

        // Removing each issue Book row cascades to its BookAuthors/BookSeries/BookTags/BookFiles/
        // Identifiers/Bookmarks/Notes/ReadingProgress via their required FK to Book, same as a
        // single book's own delete endpoint (see BookRemovalService) - and PeriodicalTags cascades
        // off the Periodical row the same way.
        db.Books.RemoveRange(periodical.Issues);
        db.Periodicals.Remove(periodical);
        await db.SaveChangesAsync(ct);

        return new PeriodicalDeleteResult(PeriodicalDeleteOutcome.Deleted, absoluteFolder, requiresLocalTrash);
    }

    public async Task<Periodical?> SaveCoverAsync(
        int periodicalId, Stream content, string contentType, CancellationToken ct = default)
    {
        var periodical = await db.Periodicals.FirstOrDefaultAsync(p => p.Id == periodicalId, ct);
        if (periodical is null)
        {
            return null;
        }

        await Storage.CreateDirectoryAsync(periodical.FolderPath, ct);
        var absoluteFolder = await Storage.GetLocalPathAsync(periodical.FolderPath, ct);

        // Remove any existing cover.* first so replacing a jpg cover with a png (or vice versa)
        // doesn't leave both sitting next to each other - CoverLocator.Find would then keep
        // serving whichever candidate it checks first, regardless of which one was just uploaded.
        await foreach (var entry in Storage.EnumerateAsync(periodical.FolderPath, ct))
        {
            if (!entry.IsDirectory && Path.GetFileName(entry.RelativePath).StartsWith("cover.", StringComparison.Ordinal))
            {
                await Storage.DeleteAsync(entry.RelativePath, recursive: false, ct);
            }
        }

        var extension = EbookFileHelpers.CoverExtensionFor(contentType);
        var coverRelative = Path.Combine(periodical.FolderPath, $"cover.{extension}");
        await using (var fileStream = File.Create(Path.Combine(absoluteFolder, $"cover.{extension}")))
        {
            await content.CopyToAsync(fileStream, ct);
        }
        await Storage.NotifyWrittenAsync(coverRelative, ct);

        return periodical;
    }

    private readonly record struct FolderMoveState(string OldRelative, string NewRelative);
}
