namespace Maktaba.Data;

/// <summary>
/// Issue #23: estimates a book's total expected reading time by extrapolating from the user's own
/// actual pace on it so far (secondsRead / percentage-complete) - there's no page/word-count
/// metadata to build a real estimate from, so this self-calibrates per book instead. Needs a
/// minimum amount of real data to avoid wild extrapolation from a few seconds of progress.
/// </summary>
public static class ReadingTimeEstimator
{
    private const double MinPercentageForEstimate = 5.0;
    private const int MinSecondsForEstimate = 60;

    public static int? EstimateTotalSeconds(int secondsRead, double percentage)
    {
        if (percentage < MinPercentageForEstimate || secondsRead < MinSecondsForEstimate)
        {
            return null;
        }

        return (int)(secondsRead / (percentage / 100.0));
    }
}
