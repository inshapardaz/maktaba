namespace Maktaba.Core.Services;

/// <summary>
/// Epic #162, Phase 1's own service - rasterizes a digitizing book's source PDF into per-page
/// images under pages/ (see the epic's on-disk layout), auto-detecting/splitting two-page spreads
/// and ordering pages per the book's own IsRightToLeft flag (see IDigitizationService.StartAsync
/// and RtlLanguages). Runs as a detached background task (like ILibraryMigrationService) since a
/// large PDF can take a while - progress is polled separately via IConversionProgressTracker rather
/// than blocking the triggering request.
/// </summary>
public interface IPdfToImageConversionService
{
    /// <summary>Starts converting <paramref name="bookId"/>'s source PDF (digitization.json must
    /// already exist - see IDigitizationService.StartAsync) in the background. Throws
    /// InvalidOperationException if a conversion is already running (this process only ever runs
    /// one at a time, matching the "digitization window is a singleton per book" design - a second
    /// book's conversion should simply queue behind it rather than run concurrently against the
    /// same MaktabaDbContext/digitization.json machinery).</summary>
    void Start(int bookId);
}
