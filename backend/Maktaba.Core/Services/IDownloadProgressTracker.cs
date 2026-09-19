namespace Maktaba.Core.Services;

// TotalBytes is null when the source didn't report a Content-Length (or equivalent) - the frontend
// falls back to showing bytes-downloaded-so-far instead of a percentage in that case.
public record DownloadProgressSnapshot(long BytesDownloaded, long? TotalBytes);

/// <summary>
/// Issue #138 - a singleton, in-memory "how far along is this download" registry, reported into by
/// ICloudCacheManager.WriteAsync's own copy loop (the one place every cloud provider's downloaded
/// bytes actually land on disk - see that method's own doc comment for why this is instrumented
/// there rather than separately in each of S3StorageProvider/GoogleDriveStorageProvider/
/// OneDriveStorageProvider/NawishtaStorageProvider). Keyed by an opaque string the caller controls
/// (BookEndpoints.cs uses "{libraryId}:{relativePath}", matching exactly what WriteAsync is already
/// called with) - this class doesn't interpret the key itself.
/// </summary>
public interface IDownloadProgressTracker
{
    void Report(string key, long bytesDownloaded, long? totalBytes);

    DownloadProgressSnapshot? TryGet(string key);

    /// <summary>Called once a download finishes (success or failure) so a stale snapshot doesn't
    /// linger and get reported back for a *later*, unrelated download that happens to reuse the
    /// same key (e.g. re-opening the same book after its cache entry was cleared).</summary>
    void Clear(string key);
}
