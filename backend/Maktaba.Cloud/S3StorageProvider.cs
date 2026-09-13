using Amazon.S3;
using Amazon.S3.Model;
using Maktaba.Core.Services;

namespace Maktaba.Cloud;

/// <summary>
/// First concrete cloud IStorageProvider - proves the abstraction end-to-end. Talks to Amazon S3
/// itself by default, or any S3-compatible provider (MinIO, Backblaze B2, DigitalOcean Spaces,
/// Cloudflare R2, a self-hosted object store, ...) when an Endpoint is configured - see
/// S3ProviderOptions.Endpoint/BuildClientConfig. Keeps a local cache mirror (via
/// ICloudCacheManager) in sync with the bucket/prefix; every method that returns a "local path"
/// downloads into that mirror first if the file isn't cached yet. Deliberately presence-only
/// caching for v1 (matches ICloudCacheManager's documented scope): once a file is cached, it's
/// trusted until explicitly re-written, with no cross-device freshness check against the remote
/// ETag/last-modified - a known v1 limitation, not an oversight.
///
/// S3 has no real directories - a "folder" is just a common key prefix. CreateDirectoryAsync only
/// ever needs to create the local cache folder; Move/Delete of a "folder" enumerate and act on
/// every object under that prefix (copy+delete per object for a move, since S3 has no rename).
/// </summary>
public class S3StorageProvider(
    string libraryId,
    S3ProviderOptions options,
    ICloudCacheManager cache) : IStorageProvider, IDisposable
{
    private const string DatabaseRelativePath = "metadata.db";

    private readonly AmazonS3Client _client =
        new(options.AccessKeyId, options.SecretAccessKey, options.BuildClientConfig());

    public string ProviderType => "s3";

    private string ToKey(string relativePath)
    {
        var normalized = relativePath.Replace('\\', '/').Trim('/');
        return string.IsNullOrEmpty(options.Prefix) ? normalized : $"{options.Prefix.Trim('/')}/{normalized}";
    }

    public async Task<string> GetLocalPathAsync(string relativePath, CancellationToken ct = default)
    {
        if (!cache.Exists(libraryId, relativePath))
        {
            await DownloadIntoCacheAsync(relativePath, ct);
        }

        return cache.GetLocalPath(libraryId, relativePath);
    }

    private async Task DownloadIntoCacheAsync(string relativePath, CancellationToken ct)
    {
        try
        {
            using var response = await _client.GetObjectAsync(options.Bucket, ToKey(relativePath), ct);
            await cache.WriteAsync(libraryId, relativePath, response.ResponseStream, ct);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // No remote object yet (e.g. a brand-new file about to be written locally then pushed
            // via NotifyWrittenAsync) - leave nothing cached rather than throwing; callers that
            // actually need the bytes to exist (a read) will get a clear file-not-found from the
            // local filesystem when they try to open the (still-missing) cache path.
        }
    }

    public async Task NotifyWrittenAsync(string relativePath, CancellationToken ct = default)
    {
        var localPath = cache.GetLocalPath(libraryId, relativePath);
        await using var stream = File.OpenRead(localPath);
        await _client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = options.Bucket,
            Key = ToKey(relativePath),
            InputStream = stream,
        }, ct);
    }

    public Task CreateDirectoryAsync(string relativePath, CancellationToken ct = default)
    {
        Directory.CreateDirectory(cache.GetLocalPath(libraryId, relativePath));
        return Task.CompletedTask;
    }

    public async Task DeleteAsync(string relativePath, bool recursive = false, CancellationToken ct = default)
    {
        cache.Delete(libraryId, relativePath, recursive);

        if (!recursive)
        {
            await _client.DeleteObjectAsync(options.Bucket, ToKey(relativePath), ct);
            return;
        }

        var prefix = ToKey(relativePath);
        var keys = await ListAllKeysAsync(prefix, ct);
        await DeleteKeysAsync(keys, ct);
    }

    public async Task MoveAsync(string fromRelativePath, string toRelativePath, CancellationToken ct = default)
    {
        var fromKey = ToKey(fromRelativePath);
        var toKey = ToKey(toRelativePath);

        // A single object (the common case: renaming one file) vs. a "folder" (every object sharing
        // fromKey as a prefix) are handled the same way below - ListAllKeysAsync(fromKey) returns
        // just [fromKey] when fromKey itself is an object with no children.
        var keys = await ListAllKeysAsync(fromKey, ct);
        if (keys.Count == 0)
        {
            keys = [fromKey];
        }

        foreach (var key in keys)
        {
            var destKey = key == fromKey ? toKey : toKey + key[fromKey.Length..];
            await _client.CopyObjectAsync(new CopyObjectRequest
            {
                SourceBucket = options.Bucket,
                SourceKey = key,
                DestinationBucket = options.Bucket,
                DestinationKey = destKey,
            }, ct);
        }

        await DeleteKeysAsync(keys, ct);

        if (cache.Exists(libraryId, fromRelativePath))
        {
            cache.Move(libraryId, fromRelativePath, toRelativePath);
        }
    }

    public async Task<bool> ExistsAsync(string relativePath, CancellationToken ct = default)
    {
        if (cache.Exists(libraryId, relativePath))
        {
            return true;
        }

        try
        {
            await _client.GetObjectMetadataAsync(options.Bucket, ToKey(relativePath), ct);
            return true;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // Not a single object - might still be a "folder" (a shared key prefix with no object
            // at that exact key), so fall through to a prefix listing before giving up.
            var prefix = ToKey(relativePath);
            var response = await _client.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = options.Bucket,
                Prefix = prefix.Length > 0 ? prefix + "/" : prefix,
                MaxKeys = 1,
            }, ct);
            return response.S3Objects is { Count: > 0 };
        }
    }

    public async IAsyncEnumerable<StorageEntry> EnumerateAsync(
        string relativePath, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        var prefix = ToKey(relativePath);
        var listPrefix = prefix.Length > 0 ? prefix + "/" : prefix;
        string? continuationToken = null;

        do
        {
            var response = await _client.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = options.Bucket,
                Prefix = listPrefix,
                Delimiter = "/",
                ContinuationToken = continuationToken,
            }, ct);

            foreach (var commonPrefix in response.CommonPrefixes ?? [])
            {
                yield return new StorageEntry(StripPrefix(commonPrefix.TrimEnd('/')), IsDirectory: true);
            }

            foreach (var obj in response.S3Objects ?? [])
            {
                if (obj.Key != listPrefix)
                {
                    yield return new StorageEntry(StripPrefix(obj.Key), IsDirectory: false);
                }
            }

            continuationToken = response.IsTruncated == true ? response.NextContinuationToken : null;
        } while (continuationToken is not null);
    }

    private string StripPrefix(string key)
    {
        var withoutBucketPrefix = string.IsNullOrEmpty(options.Prefix)
            ? key
            : key[(options.Prefix.Trim('/').Length + 1)..];
        return withoutBucketPrefix;
    }

    public async Task<string> PullDatabaseAsync(CancellationToken ct = default)
    {
        await DownloadIntoCacheAsync(DatabaseRelativePath, ct);
        return cache.GetLocalPath(libraryId, DatabaseRelativePath);
    }

    public Task PushDatabaseAsync(CancellationToken ct = default) => NotifyWrittenAsync(DatabaseRelativePath, ct);

    private async Task<List<string>> ListAllKeysAsync(string prefix, CancellationToken ct)
    {
        var keys = new List<string>();
        string? continuationToken = null;

        do
        {
            var response = await _client.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = options.Bucket,
                Prefix = prefix,
                ContinuationToken = continuationToken,
            }, ct);

            keys.AddRange((response.S3Objects ?? []).Select(o => o.Key));
            continuationToken = response.IsTruncated == true ? response.NextContinuationToken : null;
        } while (continuationToken is not null);

        return keys;
    }

    private async Task DeleteKeysAsync(IReadOnlyList<string> keys, CancellationToken ct)
    {
        // DeleteObjectsAsync (batch) caps at 1000 keys per request.
        foreach (var batch in keys.Chunk(1000))
        {
            if (batch.Length == 0)
            {
                continue;
            }

            await _client.DeleteObjectsAsync(new DeleteObjectsRequest
            {
                BucketName = options.Bucket,
                Objects = [.. batch.Select(k => new KeyVersion { Key = k })],
            }, ct);
        }
    }

    public void Dispose() => _client.Dispose();
}
