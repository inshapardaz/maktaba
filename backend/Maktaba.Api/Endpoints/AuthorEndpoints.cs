using Maktaba.Api.Dtos;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Maktaba.Data.Services;
using Maktaba.Nawishta;

namespace Maktaba.Api.Endpoints;

public static class AuthorEndpoints
{
    public static void MapAuthorEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/authors");

        // Cascades to every book by this author - see IAuthorRenameService for the on-disk folder
        // move this triggers for books where they're the primary author.
        group.MapPut("/{id}/name", async (
            string id, RenameAuthorRequestDto request, IAuthorRenameService renameService,
            ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            // Issue #145: IAuthorRenameService (below) queries MaktabaDbContext directly, which
            // doesn't exist for a Nawishta-backed library (no metadata.db) - renamed via Nawishta's
            // own real author-update endpoint instead, same "fetch existing, mutate the one field,
            // PUT the whole representation back" pattern NawishtaBookMutationService.
            // UpdateMetadataAsync already uses for books.
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                var existing = await n.Api.GetAuthorByIdAsync(n.RemoteLibraryId, authorId, ct);
                if (existing is null)
                {
                    return Results.NotFound();
                }

                // Same collision rule as the local-library branch below - excludes the author's own
                // row, so renaming to a different case/whitespace variant of their own existing name
                // isn't treated as a collision.
                var allAuthors = await n.Api.GetAuthorsAsync(n.RemoteLibraryId, ct);
                var collision = (allAuthors.Data ?? []).Any(a =>
                    a.Id != authorId && string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase));
                if (collision)
                {
                    return Results.Conflict(new { error = $"An author named \"{name}\" already exists." });
                }

                existing.Name = name;
                var updated = await n.Api.UpdateAuthorAsync(n.RemoteLibraryId, authorId, existing, ct) ?? existing;
                return Results.Ok(new BrowseGroupDto(IdCodec.Encode(authorId), updated.Name ?? name, updated.BookCount ?? 0));
            }

            var result = await renameService.RenameAsync(authorId, name, ct);
            return result.Outcome switch
            {
                AuthorRenameOutcome.Renamed => Results.Ok(
                    new BrowseGroupDto(result.AuthorId!, result.AuthorName!, result.AffectedBookCount)),
                AuthorRenameOutcome.AuthorNotFound => Results.NotFound(),
                AuthorRenameOutcome.NameConflict => Results.Conflict(new { error = $"An author named \"{name}\" already exists." }),
                _ => Results.Problem(),
            };
        });

        // Issue #28: an author photo, uploaded from the AuthorsView edit affordance - stored purely
        // as a file convention (see AuthorImageLocator), no DB column, same spirit as book/periodical
        // covers.
        group.MapGet("/{id}/image", async (
            string id, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver,
            IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            // Issue #141: AuthorImageLocator's folder-convention storage (IStorageProvider's
            // CreateDirectory/Enumerate/etc) doesn't apply to a Nawishta-backed library at all - it
            // has a real per-author image endpoint instead, fetched directly rather than through
            // IStorageProvider's cache-mirror abstraction (no local caching, same as covers being
            // eagerly cached vs content being fetched on demand isn't needed here at this pass).
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                var nawishtaImage = await n.Api.DownloadAuthorImageAsync(n.RemoteLibraryId, authorId, ct);
                return nawishtaImage is { } foundNawishta
                    ? Results.File(foundNawishta.Bytes, foundNawishta.MimeType ?? "image/jpeg")
                    : Results.NotFound();
            }

            var image = await AuthorImageLocator.FindAsync(storageFactory.Current, authorId, ct);
            return image is { } found ? Results.File(found.FilePath, found.ContentType) : Results.NotFound();
        });

        group.MapPost("/{id}/image", async (
            string id, IFormFile file, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver,
            IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            if (file.Length == 0 || (file.ContentType != "image/jpeg" && file.ContentType != "image/png"))
            {
                return Results.BadRequest(new { error = "Image must be a JPEG or PNG file." });
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                await using var nawishtaStream = file.OpenReadStream();
                await n.Api.UpdateAuthorImageAsync(n.RemoteLibraryId, authorId, file.FileName, file.ContentType, nawishtaStream, ct);
                return Results.NoContent();
            }

            await using var stream = file.OpenReadStream();
            await AuthorImageLocator.SaveAsync(storageFactory.Current, authorId, file.ContentType, stream, ct);
            return Results.NoContent();
        }).DisableAntiforgery();

        group.MapDelete("/{id}/image", async (
            string id, ILibraryService libraryService, IStorageProviderFactory storageFactory, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            // Issue #141: Nawishta has no delete-author-image endpoint at all (confirmed absent from
            // the api repo's own AuthorController) - a clean rejection rather than letting
            // NawishtaStorageProvider's generic NotSupportedException surface as an unhandled 500.
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                return Results.BadRequest(new
                {
                    error = "Removing an author's photo isn't supported for a Nawishta-backed library yet - replace it with a new photo instead, or remove it directly on the Nawishta server.",
                });
            }

            await AuthorImageLocator.DeleteAsync(storageFactory.Current, authorId, ct);
            return Results.NoContent();
        });
    }
}
