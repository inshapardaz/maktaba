namespace Maktaba.Publishing;

/// <summary>One chapter's title and its fully-merged Markdown content (see
/// IChapterMergeService in Maktaba.Core, Phase 7) - the same shape the ported
/// MarkdownToEpubConverter's own nested `Chapter` record used.</summary>
public record PublishChapter(string Title, string MarkdownContent);

/// <summary>Everything a publisher needs to generate output bytes - deliberately plain data (no
/// Maktaba.Core.Entities.Book reference) so this project stays free of any dependency beyond
/// what's needed to turn Markdown + metadata into bytes.</summary>
public record PublishInput(
    string Title,
    string? Language,
    IReadOnlyList<string> Authors,
    string? Publisher,
    string? SeriesName,
    double? SeriesIndex,
    IReadOnlyList<PublishChapter> Chapters,
    byte[]? CoverImageBytes);

/// <summary>
/// Generates one format's output bytes from already-merged chapter content (epic #162, Phase 8).
/// Deliberately narrower than the epic's own illustrative signature
/// (<c>Task PublishAsync(int bookId, CancellationToken ct)</c>) - that shape needs
/// MaktabaDbContext/IStorageProviderFactory access to load the book and write the resulting
/// BookFile, which this project (referencing only Maktaba.Core, the same isolation
/// Maktaba.Metadata already uses for format-parsing SDKs) can't have. The actual "load book,
/// call the right IBookPublisher, write/track the resulting BookFile" orchestration is
/// Maktaba.Data's DigitizationPublishingService instead - this interface is just the pure
/// bytes-in, bytes-out step.
/// </summary>
public interface IBookPublisher
{
    PublishFormat Format { get; }

    /// <summary>File extension without a leading dot (e.g. "epub").</summary>
    string FileExtension { get; }

    byte[] Generate(PublishInput input);
}
