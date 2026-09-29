namespace Maktaba.Core.Services;

/// <summary>
/// Thin wrapper over Google Vision's REST `images:annotate` endpoint (epic #162, Phase 6) - takes a
/// page image's raw bytes and returns the recognized text via DOCUMENT_TEXT_DETECTION (better
/// suited to a full scanned page than the plain TEXT_DETECTION feature, which is tuned for short
/// signage-style text). Throws InvalidOperationException (with Google's own error message) on any
/// non-success response, including a missing/invalid API key - callers surface that directly to the
/// user rather than needing their own translation layer.
/// </summary>
public interface IGoogleVisionOcrService
{
    Task<string> RecognizeTextAsync(byte[] imageBytes, string apiKey, CancellationToken ct = default);
}
