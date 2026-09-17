using Maktaba.Api.Dtos;
using Maktaba.Core.Entities;
using Maktaba.Core.Ids;
using Maktaba.Core.Services;
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
        // Every endpoint below used to go straight to MaktabaDbContext with no Nawishta awareness -
        // a Nawishta-backed library has no metadata.db, so all three would throw on every call. The
        // Nawishta branches route through ILibraryQueryServiceFactory (already Nawishta-aware) and
        // NawishtaBookQueryService.GetReadingStatsAsync (the local shadow DB), same as
        // ReaderDataEndpoints.cs's progress/reading-activity endpoints already do - see this
        // project's notes on that fix for the same reasoning. /reading-time has no Nawishta-side
        // equivalent at all (the shadow DB only ever tracks one lifetime SecondsRead total per book,
        // never a per-day/hour breakdown), so it returns a valid, all-zero report rather than
        // crashing - a deliberate "no data yet" rather than "not supported" since the shape a real
        // client renders is identical either way.
        app.MapGet("/api/analytics/summary", async (
            ILibraryService libraryService, ILibraryQueryServiceFactory queryServices, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                var result = await queryServices.Books.ListAsync(new BookQueryFilters(Page: 1, PageSize: 1000), ct);
                var nawishtaRows = new List<(int Id, string Title, string Status, int Seconds, double Percentage)>();
                foreach (var book in result.Books)
                {
                    var (seconds, percentage) = await queryServices.Books.GetReadingStatsAsync(book.Id, ct);
                    nawishtaRows.Add((book.Id, book.Title, book.ReadingStatus.ToString(), seconds, percentage ?? 0));
                }

                return Results.Ok(BuildSummary(nawishtaRows));
            }

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

            var rows = books
                .Select(b => (b.Id, b.Title, b.ReadingStatus.ToString(),
                    secondsByBook.GetValueOrDefault(b.Id, 0), percentageByBook.GetValueOrDefault(b.Id, 0.0)))
                .ToList();

            return Results.Ok(BuildSummary(rows));
        });

        app.MapGet("/api/analytics/reading-time", async (ILibraryService libraryService, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                return Results.Ok(BuildReadingTimeReport([]));
            }

            var activities = await db.ReadingActivities
                .Select(ra => new { ra.Date, ra.Hour, ra.DurationSeconds })
                .ToListAsync(ct);

            return Results.Ok(BuildReadingTimeReport(activities.Select(a => (a.Date, a.Hour, a.DurationSeconds)).ToList()));
        });

        // Library-wide "at a glance" summary - counts and total size, distinct from the reading-
        // progress/time figures above. Every query here is a plain SQL-side GroupBy/Count/Sum (no
        // in-memory pass needed, unlike /api/analytics/summary), same style as /api/reading-statuses.
        app.MapGet("/api/analytics/library-summary", async (
            ILibraryService libraryService, ILibraryQueryServiceFactory queryServices, MaktabaDbContext db, CancellationToken ct) =>
        {
            if (BookEndpoints.IsNawishtaLibrary(libraryService))
            {
                // Periodicals aren't supported for a Nawishta-backed library yet (see
                // NawishtaBookQueryService's own doc comment) - every book counts toward TotalBooks,
                // none toward TotalIssues/TotalPeriodicals.
                var result = await queryServices.Books.ListAsync(new BookQueryFilters(Page: 1, PageSize: 1000), ct);

                var nawishtaCountsByFormat = result.Books
                    .SelectMany(b => b.Files.Select(f => f.Format).Distinct())
                    .GroupBy(f => f)
                    .ToDictionary(g => g.Key, g => g.Count());
                var nawishtaBooksByFormat = Enum.GetValues<BookFormat>()
                    .Select(format => new BookFormatCountDto(format.ToString(), nawishtaCountsByFormat.GetValueOrDefault(format)))
                    .ToArray();

                var nawishtaStatusCounts = result.Books
                    .GroupBy(b => b.ReadingStatus)
                    .ToDictionary(g => g.Key, g => g.Count());
                var nawishtaBooksByStatus = Enum.GetValues<ReadingStatus>()
                    .Select(status => new ReadingStatusCountDto(status.ToString(), nawishtaStatusCounts.GetValueOrDefault(status)))
                    .ToArray();

                var authors = await queryServices.Browse.ListAuthorsAsync(ct);
                var series = await queryServices.Browse.ListSeriesAsync(ct);
                var tags = await queryServices.Browse.ListTagsAsync(ct);
                var collections = await queryServices.Collections.ListAsync(ct);

                return Results.Ok(new LibrarySummaryDto(
                    TotalBooks: result.Books.Count,
                    TotalIssues: 0,
                    BooksByFormat: nawishtaBooksByFormat,
                    BooksByReadingStatus: nawishtaBooksByStatus,
                    // Nawishta content files have no tracked size (NawishtaEntityMapper.ToBook
                    // leaves BookFile.FileSizeBytes at 0) - a known limitation elsewhere, not
                    // something this endpoint can recover on its own.
                    TotalSizeBytes: 0,
                    TotalAuthors: authors.Count,
                    TotalCollections: collections.Count,
                    TotalTags: tags.Count,
                    TotalSeries: series.Count,
                    TotalPeriodicals: 0));
            }

            var totalBooks = await db.Books.CountAsync(b => b.PeriodicalId == null, ct);
            var totalIssues = await db.Books.CountAsync(b => b.PeriodicalId != null, ct);

            // Counts *books* with at least one file of a format, not files - a book with both an
            // Epub and a Pdf attached counts in both buckets, matching how /api/books?format= (the
            // main library view's own format filter) already treats format as a per-book attribute.
            var bookCountsByFormat = await db.BookFiles
                .GroupBy(f => f.Format)
                .Select(g => new { Format = g.Key, BookCount = g.Select(f => f.BookId).Distinct().Count() })
                .ToDictionaryAsync(x => x.Format, x => x.BookCount, ct);
            var booksByFormat = Enum.GetValues<BookFormat>()
                .Select(format => new BookFormatCountDto(format.ToString(), bookCountsByFormat.GetValueOrDefault(format)))
                .ToArray();

            var statusCounts = await db.Books
                .GroupBy(b => b.ReadingStatus)
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Status, x => x.Count, ct);
            var booksByReadingStatus = Enum.GetValues<ReadingStatus>()
                .Select(status => new ReadingStatusCountDto(status.ToString(), statusCounts.GetValueOrDefault(status)))
                .ToArray();

            var totalSizeBytes = await db.BookFiles.SumAsync(f => (long?)f.FileSizeBytes, ct) ?? 0;

            var summary = new LibrarySummaryDto(
                TotalBooks: totalBooks,
                TotalIssues: totalIssues,
                BooksByFormat: booksByFormat,
                BooksByReadingStatus: booksByReadingStatus,
                TotalSizeBytes: totalSizeBytes,
                TotalAuthors: await db.Authors.CountAsync(ct),
                TotalCollections: await db.Collections.CountAsync(ct),
                TotalTags: await db.Tags.CountAsync(ct),
                TotalSeries: await db.Series.CountAsync(ct),
                TotalPeriodicals: await db.Periodicals.CountAsync(ct));

            return Results.Ok(summary);
        });
    }

    // Shared by both the local (EF-backed) and Nawishta branches of /api/analytics/summary above -
    // everything past "which books, how many seconds read, what percentage" is identical regardless
    // of where that data actually came from.
    private static AnalyticsSummaryDto BuildSummary(IReadOnlyList<(int Id, string Title, string Status, int Seconds, double Percentage)> rows)
    {
        var withEstimate = rows
            .Select(x => (x.Id, x.Title, x.Status, x.Seconds, x.Percentage, Estimate: ReadingTimeEstimator.EstimateTotalSeconds(x.Seconds, x.Percentage)))
            .ToList();

        // Library-wide average of every book with a real (self-calibrated) estimate - the
        // fallback for books with too little data of their own (typically Unread ones, which by
        // definition have zero progress to extrapolate from).
        var knownEstimates = withEstimate.Where(x => x.Estimate is not null).Select(x => x.Estimate!.Value).ToList();
        var fallbackExpected = knownEstimates.Count > 0 ? (int)knownEstimates.Average() : (int?)null;

        var bookDtos = withEstimate.Select(x =>
        {
            var expectedTotal = x.Estimate ?? fallbackExpected;
            var remaining = expectedTotal is { } total ? Math.Max(0, total - x.Seconds) : (int?)null;
            return new AnalyticsBookDto(IdCodec.Encode(x.Id), x.Title, x.Status, x.Seconds, x.Percentage, expectedTotal, remaining);
        }).ToList();

        var unread = bookDtos.Where(b => b.ReadingStatus == "Unread").ToList();
        var reading = bookDtos.Where(b => b.ReadingStatus == "Reading").ToList();
        var finishedCount = bookDtos.Count(b => b.ReadingStatus == "Finished");

        return new AnalyticsSummaryDto(
            TotalSecondsRead: bookDtos.Sum(b => b.SecondsRead),
            UnreadCount: unread.Count,
            UnreadExpectedSecondsTotal: unread.Sum(b => b.ExpectedTotalSeconds ?? 0),
            ReadingCount: reading.Count,
            ReadingSecondsSpent: reading.Sum(b => b.SecondsRead),
            ReadingSecondsRemaining: reading.Sum(b => b.RemainingSeconds ?? 0),
            FinishedCount: finishedCount,
            Books: [.. bookDtos.Where(b => b.ReadingStatus != "Unread").OrderByDescending(b => b.SecondsRead)]);
    }

    // Shared by both branches of /api/analytics/reading-time - an empty activities list (the
    // Nawishta case, which has no per-day/hour data at all) naturally zero-fills every bucket and
    // leaves MostActiveDayOfWeek/MostActiveHour null, without needing a separate code path.
    private static ReadingTimeReportDto BuildReadingTimeReport(IReadOnlyList<(DateOnly Date, int Hour, int DurationSeconds)> activities)
    {
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
        return new ReadingTimeReportDto(
            Daily: daily,
            Weekly: weekly,
            Monthly: monthly,
            ByDayOfWeek: byDayOfWeek,
            ByHour: byHour,
            MostActiveDayOfWeek: hasActivity ? byDayOfWeek.MaxBy(d => d.Seconds)!.DayOfWeek : null,
            MostActiveHour: hasActivity ? byHour.MaxBy(h => h.Seconds)!.Hour : null);
    }

    private static int DayOffsetFromMonday(DayOfWeek dayOfWeek) => ((int)dayOfWeek + 6) % 7;
}
