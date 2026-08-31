using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class BookEditService(MaktabaDbContext db, ILibraryPathProvider libraryPath) : IBookEditService
{
    public async Task<Book?> UpdateAsync(int bookId, BookEditRequest request, CancellationToken ct = default)
    {
        var book = await db.Books
            .Include(b => b.BookAuthors)
            .Include(b => b.BookSeries)
            .Include(b => b.BookTags)
            .Include(b => b.BookCollections)
            .Include(b => b.Files)
            .Include(b => b.Periodical)
            .FirstOrDefaultAsync(b => b.Id == bookId, ct);

        if (book is null)
        {
            return null;
        }

        var oldFolderRelative = book.FolderPath;

        book.Title = request.Title;
        book.SortTitle = TitleSorting.ComputeSortTitle(request.Title);
        book.Language = request.Language;
        book.Publisher = request.Publisher;
        book.DatePublished = request.PublishedDate;
        book.Description = request.Description;
        book.Rating = Math.Clamp(request.Rating, 0, 5);

        db.BookAuthors.RemoveRange(book.BookAuthors);
        book.BookAuthors.Clear();
        var authors = await EntityResolvers.ResolveAuthorsAsync(db, request.Authors, ct);
        for (var i = 0; i < authors.Count; i++)
        {
            book.BookAuthors.Add(new BookAuthor { BookId = book.Id, Author = authors[i], Order = i });
        }

        db.BookSeries.RemoveRange(book.BookSeries);
        book.BookSeries.Clear();
        var series = await EntityResolvers.ResolveSeriesAsync(db, request.SeriesName, ct);
        if (series is not null)
        {
            book.BookSeries.Add(new BookSeries
            {
                BookId = book.Id,
                Series = series,
                SeriesIndex = request.SeriesIndex ?? 0,
            });
        }

        db.BookTags.RemoveRange(book.BookTags);
        book.BookTags.Clear();
        var tags = await EntityResolvers.ResolveTagsAsync(db, request.Tags, ct);
        foreach (var tag in tags)
        {
            book.BookTags.Add(new BookTag { BookId = book.Id, Tag = tag });
        }

        db.BookCollections.RemoveRange(book.BookCollections);
        book.BookCollections.Clear();
        if (request.CollectionIds.Count > 0)
        {
            // Membership is set from *existing* collections only - Collections are user-created via
            // the manager dialog, unlike Authors/Series/Tags which are find-or-created from free text.
            var collections = await db.Collections
                .Where(c => request.CollectionIds.Contains(c.Id))
                .ToListAsync(ct);
            foreach (var collection in collections)
            {
                book.BookCollections.Add(new BookCollection { BookId = book.Id, Collection = collection });
            }
        }

        // Periodicals are explicit-create only (like Collections, unlike Authors/Series/Tags), so
        // PeriodicalId must already reference a real row - an id that fails to resolve just detaches
        // the book from any periodical rather than blocking the rest of the edit.
        book.Periodical = request.PeriodicalId is { } periodicalId
            ? await db.Periodicals.FirstOrDefaultAsync(p => p.Id == periodicalId, ct)
            : null;
        book.PeriodicalId = book.Periodical?.Id;
        book.IssueNumber = book.Periodical is not null ? request.IssueNumber : null;
        book.VolumeNumber = book.Periodical is not null ? request.VolumeNumber : null;
        book.IssueDate = book.Periodical is not null ? request.IssueDate : null;

        var move = BookFolderRelocator.RelocateIfNeeded(book, oldFolderRelative, libraryPath.LibraryRootPath!);

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            // Best-effort rollback so disk and DB don't diverge if the save fails after the move.
            if (move is { } m && Directory.Exists(m.NewAbsolute) && !Directory.Exists(m.OldAbsolute))
            {
                Directory.Move(m.NewAbsolute, m.OldAbsolute);
            }
            throw;
        }

        return book;
    }

    public async Task<BookFile?> RenameFileAsync(int bookId, int fileId, string newName, CancellationToken ct = default)
    {
        var file = await db.BookFiles.FirstOrDefaultAsync(f => f.Id == fileId && f.BookId == bookId, ct);
        if (file is null)
        {
            return null;
        }

        var root = libraryPath.LibraryRootPath!;
        var folderRelative = Path.GetDirectoryName(file.FilePath) ?? "";
        var folderAbsolute = Path.Combine(root, folderRelative);
        var extension = Path.GetExtension(file.FilePath);
        var newFileName = FileNaming.SanitizePathSegment(newName) + extension;
        var oldFileName = Path.GetFileName(file.FilePath);

        if (!string.Equals(newFileName, oldFileName, StringComparison.Ordinal))
        {
            var oldAbsolute = Path.Combine(root, file.FilePath);
            var newAbsolute = EbookFileHelpers.GetUniqueFilePath(folderAbsolute, newFileName);
            File.Move(oldAbsolute, newAbsolute);
            file.FilePath = Path.Combine(folderRelative, Path.GetFileName(newAbsolute));
        }

        file.IsCustomNamed = true;
        await db.SaveChangesAsync(ct);
        return file;
    }

    public async Task<bool?> DeleteFileAsync(int bookId, int fileId, CancellationToken ct = default)
    {
        var book = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return null;
        }

        var file = book.Files.FirstOrDefault(f => f.Id == fileId);
        if (file is null)
        {
            return null;
        }

        // A book must always have at least one attached format - deleting its last file would leave
        // an entry with nothing to read, which the frontend has no UI to recover from.
        if (book.Files.Count <= 1)
        {
            throw new InvalidOperationException("Cannot delete a book's only file.");
        }

        var root = libraryPath.LibraryRootPath!;
        var absolutePath = Path.Combine(root, file.FilePath);
        if (File.Exists(absolutePath))
        {
            File.Delete(absolutePath);
        }

        db.BookFiles.Remove(file);
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<Book?> MergeAsync(int targetBookId, int sourceBookId, CancellationToken ct = default)
    {
        if (targetBookId == sourceBookId)
        {
            throw new InvalidOperationException("Cannot merge a book with itself.");
        }

        var target = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == targetBookId, ct);
        var source = await db.Books.Include(b => b.Files).FirstOrDefaultAsync(b => b.Id == sourceBookId, ct);
        if (target is null || source is null)
        {
            return null;
        }

        var root = libraryPath.LibraryRootPath!;
        var targetFolderAbsolute = Path.Combine(root, target.FolderPath);
        Directory.CreateDirectory(targetFolderAbsolute);

        // Only files the target doesn't already have (by content, not just format - a book can have
        // two files of the same format, e.g. a custom-named alternate) are brought over, so re-merging
        // an already-merged pair (or a source with a file identical to one the target already has)
        // doesn't pile up duplicate copies.
        foreach (var file in source.Files.ToList())
        {
            if (target.Files.Any(f => f.ContentHash == file.ContentHash))
            {
                continue;
            }

            var sourceAbsolute = Path.Combine(root, file.FilePath);
            var baseFileName = FileNaming.SanitizePathSegment(target.Title) + Path.GetExtension(file.FilePath);
            var destAbsolute = EbookFileHelpers.GetUniqueFilePath(targetFolderAbsolute, baseFileName);

            if (File.Exists(sourceAbsolute))
            {
                File.Move(sourceAbsolute, destAbsolute);
            }

            var mergedFile = new BookFile
            {
                BookId = target.Id,
                Format = file.Format,
                FilePath = Path.Combine(target.FolderPath, Path.GetFileName(destAbsolute)),
                FileSizeBytes = File.Exists(destAbsolute) ? new FileInfo(destAbsolute).Length : file.FileSizeBytes,
                ContentHash = file.ContentHash,
            };
            target.Files.Add(mergedFile);
        }

        await db.SaveChangesAsync(ct);
        return target;
    }
}
