using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;

namespace Maktaba.Api.Endpoints;

public record StartDigitizationRequest(bool IsRightToLeft);

// Phase 0 (epic #162) - just the "Digitize" entry point: start a book's digitization.json and read
// its current state back. Every other digitization action (page management, OCR, chapters,
// publishing, ...) is a later phase's own endpoint set, added to this same file as it lands.
public static class DigitizationEndpoints
{
    public static void MapDigitizationEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books/{id}/digitize");

        group.MapGet("", async (
            string id, ILibraryQueryServiceFactory queryServices, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || await queryServices.Books.GetByIdAsync(bookId, ct) is null)
            {
                return Results.NotFound();
            }

            var state = await digitization.GetStateAsync(bookId, ct);
            return state is null ? Results.NotFound() : Results.Ok(state);
        });

        group.MapPost("/start", async (
            string id, StartDigitizationRequest request, ILibraryService libraryService,
            ILibraryQueryServiceFactory queryServices, IDigitizationService digitization, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            // v1 is local-library-only (epic #162's non-goals) - the frontend already hides/disables
            // the "Digitize" action for a non-local library, this is the server-side backstop.
            var activeProvider = libraryService.Libraries.FirstOrDefault(l => l.Id == libraryService.CurrentLibraryId)?.ProviderType;
            if (activeProvider != "local")
            {
                return Results.BadRequest("Digitization is only supported for local libraries.");
            }

            var book = await queryServices.Books.GetByIdAsync(bookId, ct);
            if (book is null)
            {
                return Results.NotFound();
            }

            if (!book.Files.Any(f => f.Format == BookFormat.Pdf))
            {
                return Results.BadRequest("This book has no PDF file to digitize.");
            }

            var state = await digitization.StartAsync(bookId, request.IsRightToLeft, ct);
            return Results.Ok(state);
        });
    }
}
