using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Maktaba.Nawishta.Generated;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Issue #111 (write path) - deliberately narrow: metadata edit, reading-status/rating/collection
/// (all shadow-table), and delete. Not a full <see cref="IBookEditService"/> implementation -
/// file/content management (add/rename/remove a file, merge two books) is left unimplemented on
/// purpose, since Nawishta's own content model (chapters/pages/OCR/bind/publish - see
/// NawishtaEntityMapper's doc comment) doesn't map onto "attach an EPUB/PDF" the way a local or
/// S3/Google Drive/OneDrive library's file management does, and needs live verification against a
/// real account before it's safe to build (see CLAUDE.md's Nawishta write-path section). Called
/// directly from BookEndpoints.cs's PUT/PATCH/DELETE handlers (branching on ProviderType), not
/// registered as IBookEditService/IBookRemovalService in DI - implementing only 3 of those
/// interfaces' ~7 combined methods would leave the rest silently wrong for a Nawishta library
/// instead of visibly unsupported.
/// </summary>
public class NawishtaBookMutationService(NawishtaRawApiClient api, int remoteLibraryId, NawishtaShadowDbContext shadow)
{
    public async Task<Book?> UpdateMetadataAsync(int bookId, BookEditRequest request, CancellationToken ct = default)
    {
        var existing = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct);
        if (existing is null)
        {
            return null;
        }

        existing.Title = request.Title;
        existing.Description = request.Description;
        existing.Language = request.Language ?? existing.Language ?? "en";
        existing.Publisher = request.Publisher;
        existing.Authors = await ResolveAuthorsAsync(request.Authors, ct);
        existing.SeriesId = request.SeriesName is { Length: > 0 } seriesName
            ? (await ResolveSeriesAsync(seriesName, ct))?.Id
            : null;
        existing.SeriesIndex = request.SeriesIndex is { } idx ? (int)idx : null;
        // Tags and Categories are deliberately left as fetched, not overwritten: Nawishta's own
        // reference editor (library-editor) never edits Book.Tags at all (it's read-only/system
        // output as far as that app is concerned - confirmed by its complete absence from
        // bookForm.jsx's fields), and Categories is a separate, distinct concept from Collections
        // (which map onto Nawishta's own Bookshelves as of issue #140 - see SyncCollectionsAsync).

        var updated = await api.UpdateBookAsync(remoteLibraryId, bookId, existing, ct) ?? existing;

        var state = await shadow.BookStates.FindAsync([bookId], ct);
        if (state is null)
        {
            state = new NawishtaBookState { RemoteBookId = bookId };
            shadow.BookStates.Add(state);
        }

        state.Rating = request.Rating;
        await SyncCollectionsAsync(bookId, request.CollectionIds, ct);
        await shadow.SaveChangesAsync(ct);

        return NawishtaEntityMapper.ToBook(updated, state);
    }

    public async Task<bool> SetReadingStatusAsync(int bookId, ReadingStatus status, CancellationToken ct = default)
    {
        var view = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct);
        if (view is null)
        {
            return false;
        }

        var state = await shadow.BookStates.FindAsync([bookId], ct);
        if (state is null)
        {
            state = new NawishtaBookState { RemoteBookId = bookId };
            shadow.BookStates.Add(state);
        }

        state.ReadingStatus = status;
        await shadow.SaveChangesAsync(ct);
        return true;
    }

    public async Task<bool> DeleteAsync(int bookId, CancellationToken ct = default)
    {
        await api.DeleteBookAsync(remoteLibraryId, bookId, ct);

        var state = await shadow.BookStates.FindAsync([bookId], ct);
        if (state is not null)
        {
            shadow.BookStates.Remove(state);
        }

        var links = await shadow.BookCollectionLinks.Where(l => l.RemoteBookId == bookId).ToListAsync(ct);
        shadow.BookCollectionLinks.RemoveRange(links);
        await shadow.SaveChangesAsync(ct);
        return true;
    }

    // Issue #140: book<->shelf membership now round-trips through Nawishta's real Bookshelves API
    // (AddBookToBookShelfAsync/RemoveBookFromBookShelfAsync - confirmed additive/independent server-
    // side, a book can sit on any number of shelves at once). The shadow BookCollectionLinks rows are
    // still diffed against here first, purely because Nawishta has no reverse "which shelves is this
    // book on" query to diff against directly (see NawishtaBookCollectionLink's own doc comment) -
    // they're a mirror of this app's own writes, kept in lockstep with every real API call below.
    private async Task SyncCollectionsAsync(int bookId, IReadOnlyList<int> collectionIds, CancellationToken ct)
    {
        var existing = await shadow.BookCollectionLinks.Where(l => l.RemoteBookId == bookId).ToListAsync(ct);
        var toRemove = existing.Where(l => !collectionIds.Contains(l.CollectionId)).ToList();
        var toAdd = collectionIds.Except(existing.Select(l => l.CollectionId)).ToList();

        foreach (var link in toRemove)
        {
            await api.RemoveBookFromBookShelfAsync(remoteLibraryId, link.CollectionId, bookId, ct);
        }

        foreach (var collectionId in toAdd)
        {
            await api.AddBookToBookShelfAsync(remoteLibraryId, collectionId, bookId, ct);
        }

        shadow.BookCollectionLinks.RemoveRange(toRemove);
        foreach (var collectionId in toAdd)
        {
            shadow.BookCollectionLinks.Add(new NawishtaBookCollectionLink { RemoteBookId = bookId, CollectionId = collectionId });
        }
    }

    // Find-or-create by name, case-insensitive - the same pattern Maktaba.Data/Services/
    // EntityResolvers.cs already uses for local libraries, confirmed as Nawishta's own real
    // contract by reading its reference editor (library-editor's authorsSelect.jsx): a book's
    // Authors/SeriesId must reference *existing* author/series ids, resolved by picking from a
    // list or explicitly creating one first - not resolved server-side from a bare name on the
    // book PUT itself the way Maktaba's own local-library edit flow works.
    private async Task<List<AuthorView>> ResolveAuthorsAsync(IReadOnlyList<string> names, CancellationToken ct)
    {
        var existingAuthors = ((await api.GetAuthorsAsync(remoteLibraryId, ct)).Data ?? []).ToList();
        var result = new List<AuthorView>();
        foreach (var name in names)
        {
            var match = existingAuthors.FirstOrDefault(a => string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
            {
                result.Add(match);
                continue;
            }

            var created = await api.CreateAuthorAsync(remoteLibraryId, name, ct);
            if (created is null)
            {
                continue;
            }

            result.Add(created);
            // Avoids creating a duplicate author if the same new name appears twice in one request.
            existingAuthors.Add(created);
        }

        return result;
    }

    private async Task<SeriesView?> ResolveSeriesAsync(string name, CancellationToken ct)
    {
        var existingSeries = (await api.GetSeriesAsync(remoteLibraryId, ct)).Data ?? [];
        var match = existingSeries.FirstOrDefault(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));
        return match ?? await api.CreateSeriesAsync(remoteLibraryId, name, ct);
    }
}
