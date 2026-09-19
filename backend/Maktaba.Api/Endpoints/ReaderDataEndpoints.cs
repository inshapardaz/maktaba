using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
using Maktaba.Data;
using Maktaba.Data.Services;
using Maktaba.Nawishta;
using Maktaba.Nawishta.Generated;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class ReaderDataEndpoints
{
    public static void MapReaderDataEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books/{id}");

        // Bookmarks/notes now have a real server-side equivalent on Nawishta (inshapardaz/api#53/
        // #54, shipped and live) - routed through NawishtaRawApiClient the same way progress/
        // reading-activity below already branch on IsNawishtaLibrary, rather than the earlier
        // stub (empty list / "not supported" 400) this used to return before that API existed.
        // Nawishta's own ClientId concept is exactly Maktaba's own bookmarkId/noteId route
        // parameter - both are the client-generated id qari's bookmarkAdapter/noteAdapter already
        // mint, so it's passed straight through rather than translated.
        group.MapGet("/bookmarks", async (
            string id, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.Ok(Array.Empty<BookmarkDto>());
                }

                var remoteBookmarks = await n.Api.GetBookmarksAsync(n.RemoteLibraryId, bookId, ct);
                return Results.Ok(remoteBookmarks.Select(b => new BookmarkDto(
                    b.Id ?? "", b.ChapterId, b.Position ?? 0, b.Name,
                    b.DateAdded?.UtcDateTime ?? DateTime.UtcNow, b.DateUpdated?.UtcDateTime)));
            }

            var bookmarks = await db.Bookmarks
                .Where(b => b.BookId == bookId)
                .Select(b => new BookmarkDto(b.ClientId, b.ChapterId, b.Position, b.Name, b.CreatedAt, b.UpdatedAt))
                .ToListAsync(ct);

            return Results.Ok(bookmarks);
        });

        group.MapPut("/bookmarks/{bookmarkId}", async (
            string id, string bookmarkId, SaveBookmarkRequestDto request, ILibraryService libraryService,
            NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                try
                {
                    var upserted = await n.Api.UpsertBookmarkAsync(n.RemoteLibraryId, bookId, bookmarkId, new BookmarkView
                    {
                        ChapterId = request.ChapterId,
                        Position = request.Position,
                        Name = request.Name,
                    }, ct);
                    return upserted is null ? Results.NotFound() : Results.NoContent();
                }
                catch (NawishtaApiException ex) when (ex.StatusCode == 404)
                {
                    // Nawishta's own PUT 404s cleanly for a book that doesn't exist - see
                    // UpsertBookmarkAsync's own doc comment for why this isn't folded into a null
                    // return there.
                    return Results.NotFound();
                }
            }

            if (!await db.Books.AnyAsync(b => b.Id == bookId, ct))
            {
                return Results.NotFound();
            }

            var bookmark = await db.Bookmarks.FirstOrDefaultAsync(b => b.BookId == bookId && b.ClientId == bookmarkId, ct);
            if (bookmark is null)
            {
                bookmark = new Bookmark { BookId = bookId, ClientId = bookmarkId };
                db.Bookmarks.Add(bookmark);
            }

            bookmark.ChapterId = request.ChapterId;
            bookmark.Position = request.Position;
            bookmark.Name = request.Name;
            bookmark.CreatedAt = request.CreatedAt;
            bookmark.UpdatedAt = request.UpdatedAt;

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapDelete("/bookmarks/{bookmarkId}", async (
            string id, string bookmarkId, ILibraryService libraryService,
            NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (nawishtaResolver.TryResolve(out var n))
                {
                    await n.Api.DeleteBookmarkAsync(n.RemoteLibraryId, bookId, bookmarkId, ct);
                }

                return Results.NoContent();
            }

            var deleted = await db.Bookmarks
                .Where(b => b.BookId == bookId && b.ClientId == bookmarkId)
                .ExecuteDeleteAsync(ct);

            return deleted > 0 ? Results.NoContent() : Results.NotFound();
        });

        group.MapGet("/notes", async (
            string id, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.Ok(Array.Empty<NoteDto>());
                }

                var remoteNotes = await n.Api.GetNotesAsync(n.RemoteLibraryId, bookId, ct);
                return Results.Ok(remoteNotes.Select(note => new NoteDto(
                    note.Id ?? "", note.ChapterId, note.StartOffset ?? 0, note.EndOffset ?? 0, note.Text, note.Comment,
                    note.DateAdded?.UtcDateTime ?? DateTime.UtcNow, note.DateUpdated?.UtcDateTime)));
            }

            var notes = await db.Notes
                .Where(n => n.BookId == bookId)
                .Select(n => new NoteDto(n.ClientId, n.ChapterId, n.StartOffset, n.EndOffset, n.Text, n.Comment, n.CreatedAt, n.UpdatedAt))
                .ToListAsync(ct);

            return Results.Ok(notes);
        });

        group.MapPut("/notes/{noteId}", async (
            string id, string noteId, SaveNoteRequestDto request, ILibraryService libraryService,
            NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                try
                {
                    var upserted = await n.Api.UpsertNoteAsync(n.RemoteLibraryId, bookId, noteId, new NoteView
                    {
                        ChapterId = request.ChapterId,
                        StartOffset = request.StartOffset,
                        EndOffset = request.EndOffset,
                        Text = request.Text,
                        Comment = request.Comment,
                    }, ct);
                    return upserted is null ? Results.NotFound() : Results.NoContent();
                }
                catch (NawishtaApiException ex) when (ex.StatusCode == 404)
                {
                    return Results.NotFound();
                }
            }

            if (!await db.Books.AnyAsync(b => b.Id == bookId, ct))
            {
                return Results.NotFound();
            }

            var note = await db.Notes.FirstOrDefaultAsync(n => n.BookId == bookId && n.ClientId == noteId, ct);
            if (note is null)
            {
                note = new Note { BookId = bookId, ClientId = noteId };
                db.Notes.Add(note);
            }

            note.ChapterId = request.ChapterId;
            note.StartOffset = request.StartOffset;
            note.EndOffset = request.EndOffset;
            note.Text = request.Text;
            note.Comment = request.Comment;
            note.CreatedAt = request.CreatedAt;
            note.UpdatedAt = request.UpdatedAt;

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        group.MapDelete("/notes/{noteId}", async (
            string id, string noteId, ILibraryService libraryService,
            NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (nawishtaResolver.TryResolve(out var n))
                {
                    await n.Api.DeleteNoteAsync(n.RemoteLibraryId, bookId, noteId, ct);
                }

                return Results.NoContent();
            }

            var deleted = await db.Notes
                .Where(n => n.BookId == bookId && n.ClientId == noteId)
                .ExecuteDeleteAsync(ct);

            return deleted > 0 ? Results.NoContent() : Results.NotFound();
        });

        group.MapGet("/progress", async (
            string id, ILibraryService libraryService, NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            // A Nawishta-backed library has no metadata.db - progress lives in the local shadow DB
            // instead (NawishtaBookState). This stays the sole *read* source even after issue #142
            // (which added a best-effort *push* of the overall percentage to Nawishta's own server,
            // see PUT /progress below and NawishtaRawApiClient.UpdateUserBookProgressAsync's own doc
            // comment) - reading it back from Nawishta was confirmed unreliable (its SQL Server
            // backend never returns it at all, its MySQL backend can return a different account's
            // progress via an unscoped join), and even a correct read would only ever carry a coarse
            // percentage, not the exact chapter/position qari needs to actually resume a book -
            // switching the read side to it would be a strict downgrade for the one device that
            // actually saved this progress. LastReadAt doubles as "has progress ever been saved for
            // this book", same role ReadingProgress.UpdatedAt plays for a local library below.
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                NawishtaBookState? state = nawishtaResolver.TryResolve(out var n)
                    ? await n.Shadow.BookStates.AsNoTracking().FirstOrDefaultAsync(s => s.RemoteBookId == bookId, ct)
                    : null;

                ReadingProgressDto? nawishtaDto = state?.LastReadAt is not { } lastReadAt
                    ? null
                    : new ReadingProgressDto(
                        state.CurrentChapter, state.TotalChapters, state.CurrentPage, state.TotalPages,
                        state.ChapterTitle, state.Percentage, state.ChapterId, state.Position, lastReadAt);

                return Results.Ok(nawishtaDto);
            }

            var progress = await db.ReadingProgress.AsNoTracking().FirstOrDefaultAsync(rp => rp.BookId == bookId, ct);

            // Absence of progress is a normal state (book never opened, or opened but neither
            // writer has fired yet), not an error - 200 with a null body rather than 404.
            ReadingProgressDto? dto = progress is null
                ? null
                : new ReadingProgressDto(
                    progress.CurrentChapter, progress.TotalChapters, progress.CurrentPage, progress.TotalPages,
                    progress.ChapterTitle, progress.Percentage, progress.ChapterId, progress.Position, progress.UpdatedAt);

            return Results.Ok(dto);
        });

        group.MapPut("/progress", async (
            string id, SaveReadingProgressRequestDto request, ILibraryService libraryService,
            NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, ILogger<Program> logger, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                var state = await n.Shadow.BookStates.FirstOrDefaultAsync(s => s.RemoteBookId == bookId, ct);
                if (state is null)
                {
                    state = new NawishtaBookState { RemoteBookId = bookId };
                    n.Shadow.BookStates.Add(state);
                }

                // Same partial-merge semantics as the local-library branch below (a field omitted
                // in the request means "this writer doesn't know it", not "clear it") - written via
                // ?? rather than the local branch's "is { } x" pattern to avoid that pattern
                // variable's scope (the rest of this lambda body) colliding with the same names
                // reused below.
                state.CurrentChapter = request.CurrentChapter ?? state.CurrentChapter;
                state.TotalChapters = request.TotalChapters ?? state.TotalChapters;
                state.CurrentPage = request.CurrentPage ?? state.CurrentPage;
                state.TotalPages = request.TotalPages ?? state.TotalPages;
                state.ChapterTitle = request.ChapterTitle ?? state.ChapterTitle;
                state.Percentage = request.Percentage ?? state.Percentage;
                state.ChapterId = request.ChapterId ?? state.ChapterId;
                state.Position = request.Position ?? state.Position;
                state.LastReadAt = DateTime.UtcNow;

                await n.Shadow.SaveChangesAsync(ct);

                // Issue #142 - best-effort push of the overall percentage to Nawishta's own server
                // too (see NawishtaRawApiClient.UpdateUserBookProgressAsync's own doc comment for why
                // only the percentage, not the full resume position). Never blocks/fails the save
                // itself on this - the shadow DB write above is what the reader actually depends on
                // to resume correctly on this device, this is purely a "let other clients see roughly
                // how far along this book is" sync, and Nawishta being briefly unreachable shouldn't
                // turn into a lost local progress save.
                try
                {
                    await n.Api.UpdateUserBookProgressAsync(n.RemoteLibraryId, bookId, "Pages", state.CurrentPage, state.Percentage, ct);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to sync reading progress for Nawishta book {BookId} to the server.", bookId);
                }

                return Results.NoContent();
            }

            if (!await db.Books.AnyAsync(b => b.Id == bookId, ct))
            {
                return Results.NotFound();
            }

            var progress = await db.ReadingProgress.FirstOrDefaultAsync(rp => rp.BookId == bookId, ct);
            if (progress is null)
            {
                progress = new ReadingProgress { BookId = bookId };
                db.ReadingProgress.Add(progress);
            }

            // Partial merge, not a blind overwrite: the display snapshot (CurrentChapter/...) and
            // the resume anchor (ChapterId/Position) are written independently by two different
            // reader callbacks (see ReadingProgressDto's comment) - a field omitted (null) here
            // means "this writer doesn't know it", not "clear it".
            if (request.CurrentChapter is { } currentChapter) progress.CurrentChapter = currentChapter;
            if (request.TotalChapters is { } totalChapters) progress.TotalChapters = totalChapters;
            if (request.CurrentPage is { } currentPage) progress.CurrentPage = currentPage;
            if (request.TotalPages is { } totalPages) progress.TotalPages = totalPages;
            if (request.ChapterTitle is not null) progress.ChapterTitle = request.ChapterTitle;
            if (request.Percentage is { } percentage) progress.Percentage = percentage;
            if (request.ChapterId is not null) progress.ChapterId = request.ChapterId;
            if (request.Position is { } position) progress.Position = position;
            progress.UpdatedAt = DateTime.UtcNow;

            // Whether reaching 100% (or starting a fresh book) should also flip ReadingStatus is a
            // per-user preference (auto-apply vs. ask first) with no backend awareness of it - see
            // apps/frontend/src/readerSettings.ts's getStoredAutoTagMode and ReaderOverlay.tsx's
            // maybeAutoTagStatus, which call PATCH /api/books/{id}/status explicitly instead.
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // Issue #23: the reader sends this every ~20s while its window is open and visible, with
        // however many seconds elapsed since the last heartbeat - upserted into today's row rather
        // than modeled as session start/end, so a crash or force-close never loses more than one
        // heartbeat's worth of time (see ReadingActivity's doc comment).
        group.MapPost("/reading-activity", async (
            string id, RecordReadingActivityRequestDto request, ILibraryService libraryService,
            NawishtaSessionResolver nawishtaResolver, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (request.Seconds <= 0)
            {
                return Results.NoContent();
            }

            // No per-day/hour breakdown for Nawishta (unlike ReadingActivities below) - just a
            // running lifetime total on the shadow row, which is all GetReadingStatsAsync/the
            // Continue Reading feed actually read back for a Nawishta-backed library today.
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                if (!nawishtaResolver.TryResolve(out var n))
                {
                    return Results.NotFound();
                }

                var nawishtaState = await n.Shadow.BookStates.FirstOrDefaultAsync(s => s.RemoteBookId == bookId, ct);
                if (nawishtaState is null)
                {
                    nawishtaState = new NawishtaBookState { RemoteBookId = bookId };
                    n.Shadow.BookStates.Add(nawishtaState);
                }

                nawishtaState.SecondsRead += request.Seconds;
                nawishtaState.LastReadAt = DateTime.UtcNow;
                await n.Shadow.SaveChangesAsync(ct);
                return Results.NoContent();
            }

            if (!await db.Books.AnyAsync(b => b.Id == bookId, ct))
            {
                return Results.NotFound();
            }

            var now = DateTime.Now;
            var today = DateOnly.FromDateTime(now);
            var hour = now.Hour;
            var activity = await db.ReadingActivities
                .FirstOrDefaultAsync(ra => ra.BookId == bookId && ra.Date == today && ra.Hour == hour, ct);
            if (activity is null)
            {
                activity = new ReadingActivity { BookId = bookId, Date = today, Hour = hour };
                db.ReadingActivities.Add(activity);
            }

            activity.DurationSeconds += request.Seconds;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }
}
