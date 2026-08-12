using Maktaba.Api.Dtos;
using Maktaba.Core.Ids;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class TagEndpoints
{
    public static void MapTagEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/tags");

        // Cascades to every book with this tag automatically - BookTag rows reference the Tag by
        // id, so renaming the Tag row is all that's needed (unlike authors, tags have no on-disk
        // folder implications).
        group.MapPut("/{id}/name", async (string id, RenameTagRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            var name = request.Name?.Trim();
            if (string.IsNullOrEmpty(name))
            {
                return Results.BadRequest(new { error = "Name is required." });
            }

            if (!IdCodec.TryDecode(id, out var tagId))
            {
                return Results.NotFound();
            }

            var tag = await db.Tags.FirstOrDefaultAsync(t => t.Id == tagId, ct);
            if (tag is null)
            {
                return Results.NotFound();
            }

            // Excludes the tag's own row, so renaming to a different case/whitespace variant of its
            // own existing name (a "fix the casing" rename) isn't treated as a collision.
            var collision = await db.Tags.AnyAsync(t => t.Id != tagId && t.Name.ToLower() == name.ToLower(), ct);
            if (collision)
            {
                return Results.Conflict(new { error = $"A tag named \"{name}\" already exists." });
            }

            tag.Name = name;
            var bookCount = await db.BookTags.CountAsync(bt => bt.TagId == tagId, ct);
            await db.SaveChangesAsync(ct);

            return Results.Ok(new BrowseGroupDto(IdCodec.Encode(tag.Id), tag.Name, bookCount));
        });
    }
}
