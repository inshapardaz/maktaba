using Maktaba.Core.Entities;
using Maktaba.Core.Services;
using Maktaba.Nawishta.Generated;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Nawishta;

/// <summary>
/// Issue #111 (write path) - deliberately narrow: metadata edit, reading-status/rating/collection
/// (all shadow-table), delete, and (since #150) importing a new book / adding a file to an existing
/// one. Not a full <see cref="IBookEditService"/>/<see cref="IImportService"/> implementation still -
/// renaming/removing an individual file and merging two books remain unimplemented, since neither
/// has an obvious Nawishta-side equivalent the way "upload a new content" does (confirmed live-shaped
/// against the reference editor - see NawishtaRawApiClient.UploadContentAsync's own doc comment).
/// Called directly from BookEndpoints.cs's PUT/PATCH/POST/DELETE handlers (branching on
/// ProviderType), not registered as IBookEditService/IBookRemovalService/IImportService in DI -
/// implementing only a subset of those interfaces' combined methods would leave the rest silently
/// wrong for a Nawishta library instead of visibly unsupported.
/// </summary>
public class NawishtaBookMutationService(
    NawishtaRawApiClient api, int remoteLibraryId, NawishtaShadowDbContext shadow,
    IEnumerable<IBookMetadataExtractor>? metadataExtractors = null)
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
        // Maktaba's "Tags" maps onto Nawishta's Category, not BookView's own "tags" field (see
        // NawishtaBrowseQueryService's doc comment) - written back here the same find-or-create way
        // Authors/Series already are. Distinct from Collections (which map onto Nawishta's own
        // Bookshelves as of issue #140 - see SyncCollectionsAsync), and from BookView.Tags itself,
        // which stays untouched (Nawishta's own reference editor never edits it either - confirmed
        // by its complete absence from bookForm.jsx's fields - and it's never populated by the API
        // regardless, so there'd be nothing meaningful to preserve or overwrite).
        existing.Categories = await ResolveCategoriesAsync(request.Tags, ct);

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

    // Issue #150 - the Nawishta counterpart of ImportService.ImportFileAsync: creates a new book
    // (metadata extracted locally via the same IBookMetadataExtractor implementations local/S3/
    // Google Drive/OneDrive import already uses, so this doesn't need its own EPUB/PDF parsing) then
    // uploads the picked file as its first content (NawishtaRawApiClient.UploadContentAsync - wire
    // shape confirmed against the reference editor's addBookContent, see that method's own doc
    // comment). No duplicate-detection: unlike EF-backed ImportService, there's no local content-hash
    // index to check against for a Nawishta library, and no cheap way to ask Nawishta itself "does a
    // book with this content already exist" - every import creates a new book. sourceFilePath is
    // always a plain local path the user picked (see BookEndpoints.cs's /import), never itself a
    // Nawishta-hosted file.
    public async Task<Book> ImportAsync(string sourceFilePath, CancellationToken ct = default)
    {
        var format = NawishtaEntityMapper.GuessFormat(null, sourceFilePath)
            ?? throw new NotSupportedException($"Unsupported file format: \"{Path.GetExtension(sourceFilePath)}\".");

        var extractor = metadataExtractors?.FirstOrDefault(e => e.CanHandle(sourceFilePath));
        var metadata = extractor is not null ? await extractor.ExtractAsync(sourceFilePath, ct) : null;

        var title = metadata?.Title is { Length: > 0 } extractedTitle ? extractedTitle : Path.GetFileNameWithoutExtension(sourceFilePath);
        var authors = metadata?.Authors is { Count: > 0 } authorNames ? await ResolveAuthorsAsync(authorNames, ct) : [];
        var language = metadata?.Language is { Length: > 0 } extractedLanguage ? extractedLanguage : "en";

        var newBook = new BookView
        {
            Title = title,
            Description = metadata?.Description,
            Language = language,
            Publisher = metadata?.Publisher,
            Authors = authors,
        };

        var created = await api.CreateBookAsync(remoteLibraryId, newBook, ct)
            ?? throw new InvalidOperationException("Nawishta didn't return the newly created book.");
        var bookId = created.Id ?? throw new InvalidOperationException("Nawishta's created book has no id.");

        await using (var fileStream = File.OpenRead(sourceFilePath))
        {
            await api.UploadContentAsync(
                remoteLibraryId, bookId, Path.GetFileName(sourceFilePath), NawishtaEntityMapper.MimeTypeFor(format), language, fileStream, ct);
        }

        // Best-effort, same "degrade rather than fail the whole operation" treatment covers get
        // elsewhere in this app (EnsureCoverCachedAsync, DownloadAndCacheCoverAsync) - the book
        // itself is still worth having even if its extracted cover fails to upload.
        if (metadata?.CoverImageBytes is { Length: > 0 } coverBytes)
        {
            try
            {
                var extension = metadata.CoverContentType == "image/png" ? "png" : "jpg";
                using var coverStream = new MemoryStream(coverBytes);
                await api.UpdateBookImageAsync(remoteLibraryId, bookId, $"cover.{extension}", metadata.CoverContentType ?? "image/jpeg", coverStream, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Swallowed on purpose - see this block's own comment above.
            }
        }

        var final = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct) ?? created;
        return NawishtaEntityMapper.ToBook(final, null);
    }

    // The Nawishta counterpart of ImportService.AddFileToBookAsync - uploads an additional content
    // to a book that already exists there, rather than creating a new one. Reuses the existing
    // book's own Language for the upload (Nawishta requires one per content - see
    // UploadContentAsync's own doc comment), same fallback ImportAsync above uses for a brand-new book.
    public async Task<Book?> AddFileAsync(int bookId, string sourceFilePath, CancellationToken ct = default)
    {
        var format = NawishtaEntityMapper.GuessFormat(null, sourceFilePath)
            ?? throw new NotSupportedException($"Unsupported file format: \"{Path.GetExtension(sourceFilePath)}\".");

        var existing = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct);
        if (existing is null)
        {
            return null;
        }

        await using (var fileStream = File.OpenRead(sourceFilePath))
        {
            await api.UploadContentAsync(
                remoteLibraryId, bookId, Path.GetFileName(sourceFilePath), NawishtaEntityMapper.MimeTypeFor(format),
                existing.Language is { Length: > 0 } ? existing.Language : "en", fileStream, ct);
        }

        var updated = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct) ?? existing;
        var state = await shadow.BookStates.FindAsync([bookId], ct);
        return NawishtaEntityMapper.ToBook(updated, state);
    }

    // The Nawishta counterpart of BookEditService.DeleteFileAsync - same null/refuse/true-on-success
    // contract (null = book or file not found, throws InvalidOperationException = refused because
    // it's the book's only file, true = deleted) so BookEndpoints.cs's DELETE /{id}/files/{fileId}
    // handler needs no Nawishta-specific response mapping. contentId is parsed back out of
    // BookFile.FilePath ("{bookId}/{contentId}{extension}" - see NawishtaEntityMapper.ToBook) rather
    // than trusted from fileId itself, since BookFile.Id is fileId truncated to int (Nawishta's own
    // content ids are longs) - FilePath always carries the untruncated value.
    public async Task<bool?> DeleteFileAsync(int bookId, int fileId, CancellationToken ct = default)
    {
        var book = await api.GetBookByIdAsync(remoteLibraryId, bookId, ct);
        if (book is null)
        {
            return null;
        }

        var mapped = NawishtaEntityMapper.ToBook(book, null);
        var file = mapped.Files.FirstOrDefault(f => f.Id == fileId);
        if (file is null)
        {
            return null;
        }

        if (mapped.Files.Count <= 1)
        {
            throw new InvalidOperationException("Cannot delete a book's only file.");
        }

        var contentId = long.Parse(Path.ChangeExtension(file.FilePath.Split('/', 2)[1], null));
        await api.DeleteContentAsync(remoteLibraryId, bookId, contentId, ct);
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

    // Same find-or-create shape as ResolveAuthorsAsync above (multiple names, case-insensitive
    // match against every category that already exists in this library, created if not) - the
    // write-side counterpart of NawishtaBrowseQueryService.ListTagsAsync/NawishtaEntityMapper's own
    // Category-as-Tags mapping.
    private async Task<List<CategoryView>> ResolveCategoriesAsync(IReadOnlyList<string> names, CancellationToken ct)
    {
        var existingCategories = ((await api.GetCategoriesAsync(remoteLibraryId, ct)).Data ?? []).ToList();
        var result = new List<CategoryView>();
        foreach (var name in names)
        {
            var trimmed = name.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            var match = existingCategories.FirstOrDefault(c => string.Equals(c.Name, trimmed, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
            {
                result.Add(match);
                continue;
            }

            var created = await api.CreateCategoryAsync(remoteLibraryId, trimmed, ct);
            if (created is null)
            {
                continue;
            }

            result.Add(created);
            // Avoids creating a duplicate category if the same new name appears twice in one request.
            existingCategories.Add(created);
        }

        return result;
    }
}
