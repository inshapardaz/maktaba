using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>Plain in-memory implementation of <see cref="IConversionProgressTracker"/> - registered
/// as a singleton (see Program.cs), same shape as RescanProgressTracker.</summary>
public sealed class ConversionProgressTracker : IConversionProgressTracker
{
    private readonly object gate = new();
    private ConversionProgressSnapshot snapshot = ConversionProgressSnapshot.Idle;

    public ConversionProgressSnapshot Snapshot
    {
        get
        {
            lock (gate)
            {
                return snapshot;
            }
        }
    }

    public void Start(string bookId, int total)
    {
        lock (gate)
        {
            snapshot = new ConversionProgressSnapshot(true, 0, total, bookId, null);
        }
    }

    public void Report(int processed)
    {
        lock (gate)
        {
            snapshot = snapshot with { Processed = processed };
        }
    }

    public void Fail(string error)
    {
        lock (gate)
        {
            snapshot = snapshot with { IsRunning = false, Error = error };
        }
    }

    public void Complete()
    {
        lock (gate)
        {
            snapshot = snapshot with { IsRunning = false };
        }
    }
}
