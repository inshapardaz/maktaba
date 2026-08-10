using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Data;
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

        group.MapGet("", async (MaktabaDbContext db) =>
        {
            var collections = await db.Collections
                .OrderBy(c => c.Name)
                .Select(c => new { c.Id, c.Name, Count = c.BookCollections.Count })
                .ToListAsync();
            return Results.Ok(collections.Select(c => new BrowseGroupDto(IdCodec.Encode(c.Id), c.Name, c.Count)));
        });

        group.MapPost("", async (CreateCollectionRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            var existing = await db.Collections
                .Where(c => c.Name.ToLower() == name.ToLower())
                .Select(c => new { c.Id, c.Name, Count = c.BookCollections.Count })
                .FirstOrDefaultAsync(ct);

            if (existing is not null)
            {
                return Results.Ok(new BrowseGroupDto(IdCodec.Encode(existing.Id), existing.Name, existing.Count));
            }

            var collection = new Collection { Name = name };
            db.Collections.Add(collection);
            await db.SaveChangesAsync(ct);

            var dto = new BrowseGroupDto(IdCodec.Encode(collection.Id), collection.Name, 0);
            return Results.Created($"/api/collections/{dto.Id}", dto);
        });

        group.MapDelete("/{id}", async (string id, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var collectionId))
            {
                return Results.NotFound();
            }

            var collection = await db.Collections.FindAsync([collectionId], ct);
            if (collection is null)
            {
                return Results.NotFound();
            }

            db.Collections.Remove(collection);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }
}
