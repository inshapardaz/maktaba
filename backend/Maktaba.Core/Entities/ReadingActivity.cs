namespace Maktaba.Core.Entities;

/// <summary>
/// One row per book per calendar day per local hour-of-day, accumulating actual time spent reading
/// (issue #23) - the reader sends periodic heartbeats (see BookEndpoints' POST .../reading-activity)
/// with elapsed seconds while its window is open and visible, upserted here rather than modeled as
/// session start/end timestamps, so a crash or force-close never loses more than one heartbeat's
/// worth of time and there's no session lifecycle to reconcile across separate reader windows. Date
/// and Hour are both the machine's local time (not UTC) since these buckets exist to answer "which
/// day/time does this person read at" - a question UTC would silently skew for anyone not at UTC+0.
/// The Hour split (added for the day-of-week/time-of-day reading report) means up to 24 rows can now
/// exist per book per day instead of one.
/// </summary>
public class ReadingActivity
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    public DateOnly Date { get; set; }
    public int Hour { get; set; }
    public int DurationSeconds { get; set; }
}
