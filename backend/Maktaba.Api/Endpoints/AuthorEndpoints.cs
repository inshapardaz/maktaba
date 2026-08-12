using Maktaba.Api.Dtos;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

public static class AuthorEndpoints
{
    public static void MapAuthorEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/authors");

        // Cascades to every book by this author - see IAuthorRenameService for the on-disk folder
        // move this triggers for books where they're the primary author.
        group.MapPut("/{id}/name", async (
            string id, RenameAuthorRequestDto request, IAuthorRenameService renameService, CancellationToken ct) =>
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
    }
}
