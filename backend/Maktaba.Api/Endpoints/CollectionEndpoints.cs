using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Maktaba.Data.Services;
using Maktaba.Nawishta;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

/// <summary>
/// User-managed reading collections (create/list/delete only - membership is set per-book via
/// PUT /api/books/{id}, see BookEndpoints/BookEditService). Unlike Authors/Series/Tags, collections
/// aren't derived from file metadata and are never auto-created, so a name always resolves to at
/// most one collection (case-insensitively) and every collection - even an empty one - is listed.
/// </summary>
public static class CollectionEndpoints
{
    public static void MapCollectionEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/collections");

        group.MapGet("", async (ILibraryQueryServiceFactory queryServices, CancellationToken ct) =>
        {
            var collections = await queryServices.Collections.ListAsync(ct);
            return Results.Ok(collections.Select(c =>
                new BrowseGroupDto(IdCodec.Encode(c.Id), c.Name, c.Count, ParentId: c.ParentId is { } p ? IdCodec.Encode(p) : null)));
        });

        group.MapPost("", async (
            CreateCollectionRequestDto request, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver,
            MaktabaDbContext db, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                int? nawishtaParentId = null;
                if (request.ParentId is { Length: > 0 } rawNawishtaParentId)
                {
                    if (!IdCodec.TryDecode(rawNawishtaParentId, out var decodedNawishtaParentId) ||
                        !await n.Shadow.Collections.AnyAsync(c => c.Id == decodedNawishtaParentId, ct))
                    {
                        return Results.BadRequest(new { error = "Parent collection not found." });
                    }

                    nawishtaParentId = decodedNawishtaParentId;
                }

                var existingNawishta = await n.Shadow.Collections
                    .Where(c => c.Name.ToLower() == name.ToLower())
                    .FirstOrDefaultAsync(ct);

                if (existingNawishta is not null)
                {
                    var existingCount = await n.Shadow.BookCollectionLinks.CountAsync(l => l.CollectionId == existingNawishta.Id, ct);
                    return Results.Ok(new BrowseGroupDto(IdCodec.Encode(existingNawishta.Id), existingNawishta.Name, existingCount));
                }

                var nawishtaCollection = new NawishtaShadowCollection { Name = name, ParentCollectionId = nawishtaParentId };
                n.Shadow.Collections.Add(nawishtaCollection);
                await n.Shadow.SaveChangesAsync(ct);

                var nawishtaDto = new BrowseGroupDto(IdCodec.Encode(nawishtaCollection.Id), nawishtaCollection.Name, 0, ParentId: request.ParentId);
                return Results.Created($"/api/collections/{nawishtaDto.Id}", nawishtaDto);
            }

            // A parent is only honored on first create, same as the find-or-create-by-name match
            // below not touching an already-existing collection's own parent - "add a sub-collection
            // named X under Y" shouldn't silently re-parent an unrelated pre-existing X.
            int? parentId = null;
            if (request.ParentId is { Length: > 0 } rawParentId)
            {
                if (!IdCodec.TryDecode(rawParentId, out var decodedParentId) ||
                    !await db.Collections.AnyAsync(c => c.Id == decodedParentId, ct))
                {
                    return Results.BadRequest(new { error = "Parent collection not found." });
                }

                parentId = decodedParentId;
            }

            var existing = await db.Collections
                .Where(c => c.Name.ToLower() == name.ToLower())
                .Select(c => new { c.Id, c.Name, Count = c.BookCollections.Count })
                .FirstOrDefaultAsync(ct);

            if (existing is not null)
            {
                return Results.Ok(new BrowseGroupDto(IdCodec.Encode(existing.Id), existing.Name, existing.Count));
            }

            var collection = new Collection { Name = name, ParentCollectionId = parentId };
            db.Collections.Add(collection);
            await db.SaveChangesAsync(ct);

            var dto = new BrowseGroupDto(IdCodec.Encode(collection.Id), collection.Name, 0, ParentId: request.ParentId);
            return Results.Created($"/api/collections/{dto.Id}", dto);
        });

        // Moves a collection under a new parent (or to the top level, if parentId is null) - the
        // "drag one collection row onto another to nest it" interaction in Sidebar.tsx/
        // CollectionsView.tsx.
        group.MapPut("/{id}/parent", async (
            string id, MoveCollectionRequestDto request, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver,
            MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var collectionId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                var nawishtaCollection = await n.Shadow.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct);
                if (nawishtaCollection is null)
                {
                    return Results.NotFound();
                }

                if (request.ParentId is not { Length: > 0 } rawNawishtaParentId)
                {
                    nawishtaCollection.ParentCollectionId = null;
                    await n.Shadow.SaveChangesAsync(ct);
                    var count = await n.Shadow.BookCollectionLinks.CountAsync(l => l.CollectionId == collectionId, ct);
                    return Results.Ok(new BrowseGroupDto(IdCodec.Encode(nawishtaCollection.Id), nawishtaCollection.Name, count));
                }

                if (!IdCodec.TryDecode(rawNawishtaParentId, out var nawishtaParentId))
                {
                    return Results.BadRequest(new { error = "Parent collection not found." });
                }

                if (nawishtaParentId == collectionId)
                {
                    return Results.BadRequest(new { error = "A collection can't be its own parent." });
                }

                if (await WouldCreateCycleAsync(
                    collectionId, nawishtaParentId,
                    (id, c) => n.Shadow.Collections.Where(x => x.Id == id).Select(x => x.ParentCollectionId).FirstOrDefaultAsync(c), ct))
                {
                    return Results.BadRequest(new { error = "Can't move a collection under one of its own sub-collections." });
                }

                if (!await n.Shadow.Collections.AnyAsync(c => c.Id == nawishtaParentId, ct))
                {
                    return Results.BadRequest(new { error = "Parent collection not found." });
                }

                nawishtaCollection.ParentCollectionId = nawishtaParentId;
                await n.Shadow.SaveChangesAsync(ct);

                var nawishtaCount = await n.Shadow.BookCollectionLinks.CountAsync(l => l.CollectionId == collectionId, ct);
                return Results.Ok(new BrowseGroupDto(
                    IdCodec.Encode(nawishtaCollection.Id), nawishtaCollection.Name, nawishtaCount, ParentId: rawNawishtaParentId));
            }

            var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct);
            if (collection is null)
            {
                return Results.NotFound();
            }

            if (request.ParentId is not { Length: > 0 } rawParentId)
            {
                collection.ParentCollectionId = null;
                await db.SaveChangesAsync(ct);
                return Results.Ok(new BrowseGroupDto(IdCodec.Encode(collection.Id), collection.Name, collection.BookCollections.Count));
            }

            if (!IdCodec.TryDecode(rawParentId, out var parentId))
            {
                return Results.BadRequest(new { error = "Parent collection not found." });
            }

            if (parentId == collectionId)
            {
                return Results.BadRequest(new { error = "A collection can't be its own parent." });
            }

            if (await WouldCreateCycleAsync(
                collectionId, parentId,
                (id, c) => db.Collections.Where(x => x.Id == id).Select(x => x.ParentCollectionId).FirstOrDefaultAsync(c), ct))
            {
                return Results.BadRequest(new { error = "Can't move a collection under one of its own sub-collections." });
            }

            if (!await db.Collections.AnyAsync(c => c.Id == parentId, ct))
            {
                return Results.BadRequest(new { error = "Parent collection not found." });
            }

            collection.ParentCollectionId = parentId;
            await db.SaveChangesAsync(ct);

            return Results.Ok(new BrowseGroupDto(
                IdCodec.Encode(collection.Id), collection.Name, collection.BookCollections.Count, ParentId: rawParentId));
        });

        group.MapDelete("/{id}", async (
            string id, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var collectionId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                var nawishtaCollection = await n.Shadow.Collections.FindAsync([collectionId], ct);
                if (nawishtaCollection is null)
                {
                    return Results.NotFound();
                }

                // No FK-level SetNull here (the shadow DB doesn't model relationships) - promoting
                // children to top-level is done by hand, same behavior as the local-library branch's
                // DeleteBehavior.SetNull below.
                var children = await n.Shadow.Collections.Where(c => c.ParentCollectionId == collectionId).ToListAsync(ct);
                foreach (var child in children)
                {
                    child.ParentCollectionId = null;
                }

                var links = await n.Shadow.BookCollectionLinks.Where(l => l.CollectionId == collectionId).ToListAsync(ct);
                n.Shadow.BookCollectionLinks.RemoveRange(links);

                n.Shadow.Collections.Remove(nawishtaCollection);
                await n.Shadow.SaveChangesAsync(ct);
                return Results.NoContent();
            }

            var collection = await db.Collections.FindAsync([collectionId], ct);
            if (collection is null)
            {
                return Results.NotFound();
            }

            // Children are promoted to top-level, not deleted - see DeleteBehavior.SetNull on
            // Collection.Parent (MaktabaDbContext.OnModelCreating) and that property's own doc
            // comment for why.
            db.Collections.Remove(collection);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    // Shared by both the local-library and Nawishta branches of PUT /{id}/parent above - walks the
    // proposed parent's own ancestor chain via whatever "get this collection's ParentCollectionId"
    // lookup the caller provides, so nesting "Fiction" under its own child "Fantasy" (a loop) is
    // rejected the same way regardless of which store the collection actually lives in. A plain
    // int? chase rather than a recursive query since nesting depth is expected to stay small and
    // this only runs on the rare "move" action, not every list.
    private static async Task<bool> WouldCreateCycleAsync(
        int collectionId, int parentId, Func<int, CancellationToken, Task<int?>> getParentId, CancellationToken ct)
    {
        var ancestorId = (int?)parentId;
        var visited = new HashSet<int>();
        while (ancestorId is { } current)
        {
            if (current == collectionId)
            {
                return true;
            }

            if (!visited.Add(current))
            {
                // Defensive only - a pre-existing cycle should be impossible given this same check
                // runs on every move, but bail out rather than loop forever if one is ever found.
                break;
            }

            ancestorId = await getParentId(current, ct);
        }

        return false;
    }
}
