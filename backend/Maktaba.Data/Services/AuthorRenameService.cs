using Maktaba.Core.Ids;
using Maktaba.Core.Naming;
using Maktaba.Core.Services;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Data.Services;

public class AuthorRenameService(MaktabaDbContext db, ILibraryPathProvider libraryPath) : IAuthorRenameService
{
    public async Task<AuthorRenameResult> RenameAsync(int authorId, string newName, CancellationToken ct = default)
    {
        var trimmed = newName.Trim();

        var author = await db.Authors.FirstOrDefaultAsync(a => a.Id == authorId, ct);
        if (author is null)
        {
            return new AuthorRenameResult(AuthorRenameOutcome.AuthorNotFound);
        }

        // Excludes the author's own row, so renaming to a different case/whitespace variant of
        // their own existing name (a "fix the casing" rename) isn't treated as a collision.
        var collision = await db.Authors.AnyAsync(a => a.Id != authorId && a.Name.ToLower() == trimmed.ToLower(), ct);
        if (collision)
        {
            return new AuthorRenameResult(AuthorRenameOutcome.NameConflict);
        }

        var libraryRoot = libraryPath.LibraryRootPath!;

        var books = await db.Books
            .Include(b => b.BookAuthors).ThenInclude(ba => ba.Author)
            .Include(b => b.Files)
            .Include(b => b.Periodical)
            .Where(b => b.BookAuthors.Any(ba => ba.AuthorId == authorId))
            .ToListAsync(ct);

        author.Name = trimmed;
        author.SortName = TitleSorting.ComputeAuthorSortName(trimmed);

        // Only books where this author is the primary (Order 0) author move folders - a
        // secondary/co-author's rename doesn't change where the book lives, mirroring
        // BookEditService's own "primary author only" folder-naming rule.
        var moves = new List<BookFolderRelocator.FolderMove>();
        try
        {
            foreach (var book in books)
            {
                var isPrimaryAuthor = book.BookAuthors.OrderBy(ba => ba.Order).First().AuthorId == authorId;
                if (!isPrimaryAuthor)
                {
                    continue;
                }

                var move = BookFolderRelocator.RelocateIfNeeded(book, book.FolderPath, libraryRoot);
                if (move is { } m)
                {
                    moves.Add(m);
                }
            }

            await db.SaveChangesAsync(ct);
        }
        catch
        {
            // Best-effort rollback of every folder move already performed, so disk and DB don't
            // diverge if a later book's move fails partway through (mirrors BookEditService's
            // single-book rollback, extended to "undo everything moved so far").
            foreach (var move in moves)
            {
                if (Directory.Exists(move.NewAbsolute) && !Directory.Exists(move.OldAbsolute))
                {
                    Directory.Move(move.NewAbsolute, move.OldAbsolute);
                }
            }
            throw;
        }

        return new AuthorRenameResult(AuthorRenameOutcome.Renamed, IdCodec.Encode(author.Id), author.Name, books.Count);
    }
}
