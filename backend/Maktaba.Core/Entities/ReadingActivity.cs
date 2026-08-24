namespace Maktaba.Core.Entities;

/// <summary>
/// One row per book per calendar day, accumulating actual time spent reading (issue #23) - the
/// reader sends periodic heartbeats (see BookEndpoints' POST .../reading-activity) with elapsed
/// seconds while its window is open and visible, upserted here rather than modeled as
/// session start/end timestamps, so a crash or force-close never loses more than one heartbeat's
/// worth of time and there's no session lifecycle to reconcile across separate reader windows.
/// </summary>
public class ReadingActivity
{
    public int Id { get; set; }

    public int BookId { get; set; }
    public Book Book { get; set; } = null!;

    public DateOnly Date { get; set; }
    public int DurationSeconds { get; set; }
}
