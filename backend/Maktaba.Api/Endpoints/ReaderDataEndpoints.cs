using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

public static class ReaderDataEndpoints
{
    public static void MapReaderDataEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/books/{id}");

        group.MapGet("/bookmarks", async (string id, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var bookmarks = await db.Bookmarks
                .Where(b => b.BookId == bookId)
                .Select(b => new BookmarkDto(b.ClientId, b.ChapterId, b.Position, b.Name, b.CreatedAt, b.UpdatedAt))
                .ToListAsync(ct);

            return Results.Ok(bookmarks);
        });

        group.MapPut("/bookmarks/{bookmarkId}", async (
            string id, string bookmarkId, SaveBookmarkRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || !await db.Books.AnyAsync(b => b.Id == bookId, ct))
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
            string id, string bookmarkId, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var deleted = await db.Bookmarks
                .Where(b => b.BookId == bookId && b.ClientId == bookmarkId)
                .ExecuteDeleteAsync(ct);

            return deleted > 0 ? Results.NoContent() : Results.NotFound();
        });

        group.MapGet("/notes", async (string id, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var notes = await db.Notes
                .Where(n => n.BookId == bookId)
                .Select(n => new NoteDto(n.ClientId, n.ChapterId, n.StartOffset, n.EndOffset, n.Text, n.Comment, n.CreatedAt, n.UpdatedAt))
                .ToListAsync(ct);

            return Results.Ok(notes);
        });

        group.MapPut("/notes/{noteId}", async (
            string id, string noteId, SaveNoteRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId) || !await db.Books.AnyAsync(b => b.Id == bookId, ct))
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
            string id, string noteId, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            var deleted = await db.Notes
                .Where(n => n.BookId == bookId && n.ClientId == noteId)
                .ExecuteDeleteAsync(ct);

            return deleted > 0 ? Results.NoContent() : Results.NotFound();
        });

        group.MapGet("/progress", async (string id, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
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
            string id, SaveReadingProgressRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
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
            string id, RecordReadingActivityRequestDto request, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (!IdCodec.TryDecode(id, out var bookId))
            {
                return Results.NotFound();
            }

            if (request.Seconds <= 0)
            {
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
