namespace Maktaba.Core.Services;

/// <summary>
/// Merges a chapter's pages (in page order) into one Markdown string with hidden page-boundary
/// markers inserted between them (epic #162, Phase 7 - issue #191) - exactly the shape
/// Phase 8's EpubPublisher/MarkdownToEpubConverter port expects as a chapter's own
/// MarkdownContent. Computed fresh on every call from each page's current .md file rather than
/// persisted anywhere - a page's text can keep changing after an earlier merge/preview, and
/// Publish (Phase 8) always wants the latest content, so caching this would just be a staleness
/// bug waiting to happen.
/// </summary>
public interface IChapterMergeService
{
    /// <summary>The merged Markdown for one chapter. Empty string if the chapter has no pages.</summary>
    Task<string> MergeChapterAsync(int bookId, string chapterId, CancellationToken ct = default);

    /// <summary>Every chapter's merged Markdown, keyed by chapter id, in chapter order.</summary>
    Task<IReadOnlyDictionary<string, string>> MergeAllChaptersAsync(int bookId, CancellationToken ct = default);
}
