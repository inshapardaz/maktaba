using Maktaba.Api.Dtos;
using Maktaba.Core.Ids;
using Maktaba.Data;
using Microsoft.EntityFrameworkCore;

namespace Maktaba.Api.Endpoints;

/// <summary>Issue #23: reading-activity reports - total time read, per-book time/estimates, and
/// aggregate unread/in-progress figures. See ReadingActivity/ReadingTimeEstimator for how the
/// underlying numbers are captured and estimated.</summary>
public static class AnalyticsEndpoints
{
    public static void MapAnalyticsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/analytics/summary", async (MaktabaDbContext db, CancellationToken ct) =>
        {
            var books = await db.Books
                .Select(b => new { b.Id, b.Title, b.ReadingStatus })
                .ToListAsync(ct);

            var secondsByBook = await db.ReadingActivities
                .GroupBy(ra => ra.BookId)
                .Select(g => new { BookId = g.Key, Seconds = g.Sum(ra => ra.DurationSeconds) })
                .ToDictionaryAsync(x => x.BookId, x => x.Seconds, ct);

            var percentageByBook = await db.ReadingProgress
                .Select(rp => new { rp.BookId, rp.Percentage })
                .ToDictionaryAsync(x => x.BookId, x => x.Percentage, ct);

            var perBook = books.Select(b =>
            {
                var seconds = secondsByBook.GetValueOrDefault(b.Id, 0);
                var percentage = percentageByBook.GetValueOrDefault(b.Id, 0.0);
                var estimate = ReadingTimeEstimator.EstimateTotalSeconds(seconds, percentage);
                return (b.Id, b.Title, Status: b.ReadingStatus.ToString(), Seconds: seconds, Percentage: percentage, Estimate: estimate);
            }).ToList();

            // Library-wide average of every book with a real (self-calibrated) estimate - the
            // fallback for books with too little data of their own (typically Unread ones, which by
            // definition have zero progress to extrapolate from).
            var knownEstimates = perBook.Where(x => x.Estimate is not null).Select(x => x.Estimate!.Value).ToList();
            var fallbackExpected = knownEstimates.Count > 0 ? (int)knownEstimates.Average() : (int?)null;

            var bookDtos = perBook.Select(x =>
            {
                var expectedTotal = x.Estimate ?? fallbackExpected;
                var remaining = expectedTotal is { } total ? Math.Max(0, total - x.Seconds) : (int?)null;
                return new AnalyticsBookDto(IdCodec.Encode(x.Id), x.Title, x.Status, x.Seconds, x.Percentage, expectedTotal, remaining);
            }).ToList();

            var unread = bookDtos.Where(b => b.ReadingStatus == "Unread").ToList();
            var reading = bookDtos.Where(b => b.ReadingStatus == "Reading").ToList();
            var finishedCount = bookDtos.Count(b => b.ReadingStatus == "Finished");

            var summary = new AnalyticsSummaryDto(
                TotalSecondsRead: bookDtos.Sum(b => b.SecondsRead),
                UnreadCount: unread.Count,
                UnreadExpectedSecondsTotal: unread.Sum(b => b.ExpectedTotalSeconds ?? 0),
                ReadingCount: reading.Count,
                ReadingSecondsSpent: reading.Sum(b => b.SecondsRead),
                ReadingSecondsRemaining: reading.Sum(b => b.RemainingSeconds ?? 0),
                FinishedCount: finishedCount,
                Books: [.. bookDtos.OrderByDescending(b => b.SecondsRead)]);

            return Results.Ok(summary);
        });
    }
}
