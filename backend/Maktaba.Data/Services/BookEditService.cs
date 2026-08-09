using Maktaba.Core.Entities;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class BookEditService(MaktabaDbContext db, ILibraryPathProvider libraryPath) : IBookEditService
{
    private readonly record struct FolderMove(string OldAbsolute, string NewAbsolute);

    public async Task<Book?> UpdateAsync(Guid bookId, BookEditRequest request, CancellationToken ct = default)
    {
        var book = await db.Books
            .Include(b => b.BookAuthors)
            .Include(b => b.BookSeries)
            .Include(b => b.BookTags)
            .Include(b => b.Files)
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

        var move = RelocateOnDiskIfNeeded(book, oldFolderRelative);

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

    /// <summary>
    /// Renames/moves the book's on-disk folder (and its files) to match a new title/primary-author,
    /// mirroring the "{AuthorSortName}/{Title} ({BookId})" layout ImportService creates on import.
    /// No-op if neither title nor primary author changed.
    /// </summary>
    private FolderMove? RelocateOnDiskIfNeeded(Book book, string oldFolderRelative)
    {
        var libraryRoot = libraryPath.LibraryRootPath!;

        var newAuthorSortName = book.BookAuthors
            .OrderBy(ba => ba.Order)
            .Select(ba => ba.Author.SortName)
            .FirstOrDefault() ?? "Unknown Author";

        var newFolderRelative = Path.Combine(
            FileNaming.SanitizePathSegment(newAuthorSortName),
            FileNaming.SanitizePathSegment($"{book.Title} ({book.Id})"));

        if (string.Equals(newFolderRelative, oldFolderRelative, StringComparison.Ordinal))
        {
            return null;
        }

        var oldAbsolute = Path.Combine(libraryRoot, oldFolderRelative);
        var newAbsolute = Path.Combine(libraryRoot, newFolderRelative);

        Directory.CreateDirectory(Path.GetDirectoryName(newAbsolute)!);
        Directory.Move(oldAbsolute, newAbsolute);
        book.FolderPath = newFolderRelative;

        var oldAuthorFolder = Path.GetDirectoryName(oldAbsolute)!;
        if (Directory.Exists(oldAuthorFolder) && Directory.EnumerateFileSystemEntries(oldAuthorFolder).Any() == false)
        {
            Directory.Delete(oldAuthorFolder);
        }

        foreach (var file in book.Files)
        {
            var oldFileName = Path.GetFileName(file.FilePath);
            var newFileName = FileNaming.SanitizePathSegment(book.Title) + Path.GetExtension(file.FilePath);

            if (string.Equals(oldFileName, newFileName, StringComparison.Ordinal))
            {
                file.FilePath = Path.Combine(newFolderRelative, oldFileName);
                continue;
            }

            var oldFileAbsolute = Path.Combine(newAbsolute, oldFileName);
            var newFileAbsolute = EbookFileHelpers.GetUniqueFilePath(newAbsolute, newFileName);
            File.Move(oldFileAbsolute, newFileAbsolute);
            file.FilePath = Path.Combine(newFolderRelative, Path.GetFileName(newFileAbsolute));
        }

        return new FolderMove(oldAbsolute, newAbsolute);
    }
}
