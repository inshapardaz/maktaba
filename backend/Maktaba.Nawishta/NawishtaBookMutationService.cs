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
        // Nawishta's own PUT semantics for authors/tags-by-name (find-or-create vs. requiring an
        // existing id) haven't been confirmed against a real account yet - sent as name-only stubs,
        // matching how a fresh AuthorView/TagView looks right after CreateAsync, and flagged here so
        // this is the first place to check if a real edit doesn't behave as expected.
        existing.Authors = [.. request.Authors.Select(name => new AuthorView { Name = name })];
        existing.Tags = [.. request.Tags.Select(name => new TagView { Name = name })];
        existing.SeriesName = request.SeriesName;
        existing.SeriesIndex = request.SeriesIndex is { } idx ? (int)idx : null;

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

    private async Task SyncCollectionsAsync(int bookId, IReadOnlyList<int> collectionIds, CancellationToken ct)
    {
        var existing = await shadow.BookCollectionLinks.Where(l => l.RemoteBookId == bookId).ToListAsync(ct);
        var toRemove = existing.Where(l => !collectionIds.Contains(l.CollectionId));
        shadow.BookCollectionLinks.RemoveRange(toRemove);

        foreach (var collectionId in collectionIds.Except(existing.Select(l => l.CollectionId)))
        {
            shadow.BookCollectionLinks.Add(new NawishtaBookCollectionLink { RemoteBookId = bookId, CollectionId = collectionId });
        }
    }
}
