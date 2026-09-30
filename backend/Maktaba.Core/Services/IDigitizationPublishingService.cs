using Maktaba.Core.Entities;

namespace Maktaba.Core.Services;

/// <summary>
/// Orchestrates a digitized book's publish step (epic #162, Phase 8): merges every chapter's pages
/// (via IChapterMergeService), hands the result to the right Maktaba.Publishing.IBookPublisher, and
/// writes the output as a normal BookFile in the book's own folder - not a separate publish/
/// subfolder, per the epic's amendment. Re-publishing the same format updates the previously
/// published BookFile in place (matched by its own file path) rather than creating a duplicate.
/// Takes <paramref name="format"/> as a plain string ("Epub"/"Markdown"/"Pdf") rather than
/// Maktaba.Publishing's own PublishFormat enum, since Maktaba.Core has no dependency on that
/// project (same "pure, narrowly-scoped" isolation Maktaba.Metadata's SDK wrapping already uses).
/// </summary>
public interface IDigitizationPublishingService
{
    Task<BookFile> PublishAsync(int bookId, string format, CancellationToken ct = default);
}
