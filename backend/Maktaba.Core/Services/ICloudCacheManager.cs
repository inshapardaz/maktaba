namespace Maktaba.Core.Services;

public record CloudCacheEntry(string RelativePath, bool IsDirectory);

/// <summary>
/// Per-library local cache mirror that a cloud-backed <see cref="IStorageProvider"/> (S3/OneDrive/
/// Google Drive/Nawishta, added in later phases) builds on: a working copy of the library's file
/// tree at a fixed local location, addressed the same way <see cref="IStorageProvider"/> itself is
/// - by a path relative to the library root. <see cref="LocalFileSystemProvider"/> has no use for
/// this (a local library's "cache" is just the library itself).
///
/// Deliberately scoped to presence/mirroring only, not freshness: whether a cached copy needs
/// re-downloading before use is provider-specific (an S3 ETag, a OneDrive/Google Drive change
/// token, a Nawishta Etag/last-modified header - none of which exist yet), so each concrete
/// provider decides that for itself and calls <see cref="WriteAsync"/> to refresh a stale entry
/// rather than this manager guessing at staleness on its own.
/// </summary>
public interface ICloudCacheManager
{
    /// <summary>Absolute local folder this library's cache mirror lives under.</summary>
    string GetCacheRoot(string libraryId);

    /// <summary>Resolves a library-relative path to its local cache location - does not imply the
    /// file exists there yet.</summary>
    string GetLocalPath(string libraryId, string relativePath);

    bool Exists(string libraryId, string relativePath);

    /// <summary>Writes (or overwrites) a cached file's contents, creating its parent folder(s) first.</summary>
    Task WriteAsync(string libraryId, string relativePath, Stream content, CancellationToken ct = default);

    void Delete(string libraryId, string relativePath, bool recursive = false);

    void Move(string libraryId, string fromRelativePath, string toRelativePath);

    /// <summary>Lists the immediate children of a cached folder (relative to the library root, not
    /// recursive) - empty if the folder isn't cached at all.</summary>
    IEnumerable<CloudCacheEntry> Enumerate(string libraryId, string relativePath);
}
