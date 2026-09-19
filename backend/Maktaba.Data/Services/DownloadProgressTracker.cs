using System.Collections.Concurrent;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <inheritdoc cref="IDownloadProgressTracker"/>
public class DownloadProgressTracker : IDownloadProgressTracker
{
    private readonly ConcurrentDictionary<string, DownloadProgressSnapshot> _snapshots = new();

    public void Report(string key, long bytesDownloaded, long? totalBytes) =>
        _snapshots[key] = new DownloadProgressSnapshot(bytesDownloaded, totalBytes);

    public DownloadProgressSnapshot? TryGet(string key) =>
        _snapshots.TryGetValue(key, out var snapshot) ? snapshot : null;

    public void Clear(string key) => _snapshots.TryRemove(key, out _);
}
