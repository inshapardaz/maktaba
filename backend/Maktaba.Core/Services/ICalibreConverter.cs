namespace Maktaba.Core.Services;

/// <summary>Thin wrapper around Calibre's `ebook-convert` CLI, if it's present on PATH.</summary>
public interface ICalibreConverter
{
    /// <summary>
    /// Whether `ebook-convert` resolved on PATH at startup. Checked once and cached, since probing a
    /// subprocess on every request would be wasteful and Calibre's presence doesn't change at runtime.
    /// </summary>
    bool IsAvailable { get; }

    Task ConvertAsync(string sourceFilePath, string destinationFilePath, CancellationToken ct = default);
}
