namespace Maktaba.Core.Services;

/// <summary>Thrown by LibraryService.ActivateAsync's cloud-library lock check (issue #103) when a
/// *different*, non-stale device already holds the write lock for the cloud library being opened/
/// switched to - see LibraryLockInfo's own staleness rules. Mirrors LibraryNotOpenException's own
/// "a plain, friendly-message InvalidOperationException subtype the API layer knows to catch and
/// turn into a clean JSON error" shape (Program.cs's middleware), rather than letting this surface
/// as an unhandled 500 - which is what it did before this type existed, since a generic
/// InvalidOperationException isn't caught anywhere and the frontend's request() helper falls back
/// to a bare "Request failed: 500" when a response isn't valid JSON (an unhandled-exception response
/// isn't).</summary>
public class LibraryLockConflictException(string deviceName)
    : InvalidOperationException(
        $"This library is currently open on \"{deviceName}\". Close it there first, " +
        "or try again in a couple of minutes if that device is offline or crashed.")
{
    public string DeviceName { get; } = deviceName;
}
