using Maktaba.Core.Entities;
using Maktaba.Core.Services;

namespace Maktaba.Data.Services;

// Scaffolding only (issue #167) - implemented in Phase 4 (Chapters).
public class ChapterService : IChapterService
{
    public Task<Chapter> CreateAsync(int bookId, string title, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 4 (Chapters).");

    public Task RenameAsync(int bookId, int chapterId, string title, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 4 (Chapters).");

    public Task ReorderAsync(int bookId, IReadOnlyList<int> chapterIdsInOrder, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 4 (Chapters).");

    public Task DeleteAsync(int bookId, int chapterId, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 4 (Chapters).");

    public Task SetFirstPageAsync(int bookId, int chapterId, int pageId, CancellationToken ct = default) =>
        throw new NotImplementedException("Implemented in Phase 4 (Chapters).");
}
