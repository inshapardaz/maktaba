using Maktaba.Api.Dtos;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

public static class LibraryEndpoints
{
    public static void MapLibraryEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/libraries");

        group.MapGet("/current", (ILibraryService libraryService) =>
            libraryService.LibraryRootPath is { } path
                ? Results.Ok(new LibraryDto(path))
                : Results.NoContent());

        group.MapPost("/open", async (OpenLibraryRequest request, ILibraryService libraryService, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.Path))
            {
                return Results.BadRequest(new { error = "Path is required." });
            }

            var info = await libraryService.OpenAsync(request.Path, ct);
            return Results.Ok(new LibraryDto(info.Path));
        });
    }
}
