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
                Books: [.. bookDtos.Where(b => b.ReadingStatus != "Unread").OrderByDescending(b => b.SecondsRead)]);

            return Results.Ok(summary);
        });

        app.MapGet("/api/analytics/reading-time", async (MaktabaDbContext db, CancellationToken ct) =>
        {
            var activities = await db.ReadingActivities
                .Select(ra => new { ra.Date, ra.Hour, ra.DurationSeconds })
                .ToListAsync(ct);

            var today = DateOnly.FromDateTime(DateTime.Now);

            var dailyTotals = activities.GroupBy(a => a.Date).ToDictionary(g => g.Key, g => g.Sum(a => a.DurationSeconds));
            var daily = Enumerable.Range(0, 30)
                .Select(i => today.AddDays(-29 + i))
                .Select(d => new ReadingTimePointDto(d.ToString("yyyy-MM-dd"), dailyTotals.GetValueOrDefault(d, 0)))
                .ToArray();

            var currentWeekStart = today.AddDays(-DayOffsetFromMonday(today.DayOfWeek));
            var weekly = Enumerable.Range(0, 12)
                .Select(i => currentWeekStart.AddDays(-7 * (11 - i)))
                .Select(weekStart =>
                {
                    var seconds = Enumerable.Range(0, 7)
                        .Select(d => dailyTotals.GetValueOrDefault(weekStart.AddDays(d), 0))
                        .Sum();
                    return new ReadingTimeWeekDto(weekStart.ToString("yyyy-MM-dd"), seconds);
                })
                .ToArray();

            var currentMonthStart = new DateOnly(today.Year, today.Month, 1);
            var monthly = Enumerable.Range(0, 12)
                .Select(i => currentMonthStart.AddMonths(-11 + i))
                .Select(monthStart =>
                {
                    var seconds = dailyTotals
                        .Where(kv => kv.Key.Year == monthStart.Year && kv.Key.Month == monthStart.Month)
                        .Sum(kv => kv.Value);
                    return new ReadingTimeMonthDto(monthStart.ToString("yyyy-MM"), seconds);
                })
                .ToArray();

            var dayOfWeekTotals = activities
                .GroupBy(a => (int)a.Date.DayOfWeek)
                .ToDictionary(g => g.Key, g => g.Sum(a => a.DurationSeconds));
            var byDayOfWeek = Enumerable.Range(0, 7)
                .Select(d => new ReadingTimeDayOfWeekDto(d, dayOfWeekTotals.GetValueOrDefault(d, 0)))
                .ToArray();

            var hourTotals = activities.GroupBy(a => a.Hour).ToDictionary(g => g.Key, g => g.Sum(a => a.DurationSeconds));
            var byHour = Enumerable.Range(0, 24)
                .Select(h => new ReadingTimeHourDto(h, hourTotals.GetValueOrDefault(h, 0)))
                .ToArray();

            var hasActivity = activities.Count > 0;
            var report = new ReadingTimeReportDto(
                Daily: daily,
                Weekly: weekly,
                Monthly: monthly,
                ByDayOfWeek: byDayOfWeek,
                ByHour: byHour,
                MostActiveDayOfWeek: hasActivity ? byDayOfWeek.MaxBy(d => d.Seconds)!.DayOfWeek : null,
                MostActiveHour: hasActivity ? byHour.MaxBy(h => h.Seconds)!.Hour : null);

            return Results.Ok(report);
        });
    }

    private static int DayOffsetFromMonday(DayOfWeek dayOfWeek) => ((int)dayOfWeek + 6) % 7;
}
