using Maktaba.Api.Dtos;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;

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

        // Issue #28: an author photo, uploaded from the AuthorsView edit affordance - stored purely
        // as a file convention (see AuthorImageLocator), no DB column, same spirit as book/periodical
        // covers.
        group.MapGet("/{id}/image", (string id, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            var image = AuthorImageLocator.Find(libraryPath.LibraryRootPath!, authorId);
            return image is { } found ? Results.File(found.FilePath, found.ContentType) : Results.NotFound();
        });

        group.MapPost("/{id}/image", async (string id, IFormFile file, ILibraryPathProvider libraryPath, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            if (file.Length == 0 || (file.ContentType != "image/jpeg" && file.ContentType != "image/png"))
            {
                return Results.BadRequest(new { error = "Image must be a JPEG or PNG file." });
            }

            var destination = AuthorImageLocator.Save(libraryPath.LibraryRootPath!, authorId, file.ContentType);
            await using var fileStream = File.Create(destination);
            await file.CopyToAsync(fileStream, ct);
            return Results.NoContent();
        }).DisableAntiforgery();

        group.MapDelete("/{id}/image", (string id, ILibraryPathProvider libraryPath) =>
        {
            if (!IdCodec.TryDecode(id, out var authorId))
            {
                return Results.NotFound();
            }

            AuthorImageLocator.Delete(libraryPath.LibraryRootPath!, authorId);
            return Results.NoContent();
        });
    }
}
