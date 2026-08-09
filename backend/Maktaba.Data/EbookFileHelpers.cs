using System.Security.Cryptography;
using Maktaba.Core.Entities;

namespace Maktaba.Data;

/// <summary>File-level helpers shared by import and library-rescan.</summary>
internal static class EbookFileHelpers
{
    public static BookFormat DetectFormat(string filePath) => Path.GetExtension(filePath).ToLowerInvariant() switch
    {
        ".epub" => BookFormat.Epub,
        ".pdf" => BookFormat.Pdf,
        var ext => throw new NotSupportedException($"Unsupported ebook file type: {ext}"),
    };

    public static string CoverExtensionFor(string? contentType) => contentType switch
    {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        _ => "jpg",
    };

    public static async Task<string> ComputeSha256Async(string filePath, CancellationToken ct)
    {
        await using var stream = File.OpenRead(filePath);
        var hashBytes = await SHA256.HashDataAsync(stream, ct);
        return Convert.ToHexString(hashBytes).ToLowerInvariant();
    }

    /// <summary>Appends " (2)", " (3)", etc. before the extension until the path doesn't already exist.</summary>
    public static string GetUniqueFilePath(string folder, string fileName)
    {
        var candidate = Path.Combine(folder, fileName);
        if (!File.Exists(candidate))
        {
            return candidate;
        }

        var nameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);

        for (var i = 2; ; i++)
        {
            var next = Path.Combine(folder, $"{nameWithoutExt} ({i}){ext}");
            if (!File.Exists(next))
            {
                return next;
            }
        }
    }
}
