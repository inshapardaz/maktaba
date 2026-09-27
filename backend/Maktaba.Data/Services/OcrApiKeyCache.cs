using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

/// <summary>Plain in-memory implementation of <see cref="IOcrApiKeyCache"/> - registered singleton
/// (see Program.cs), same shape as ICloudCredentialCache.</summary>
public sealed class OcrApiKeyCache : IOcrApiKeyCache
{
    public string? ApiKey { get; set; }
}
