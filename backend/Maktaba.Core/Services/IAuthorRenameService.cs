namespace Maktaba.Core.Services;

public enum AuthorRenameOutcome
{
    Renamed,
    AuthorNotFound,

    /// <summary>
    /// Another author already has this name (case-insensitive). Deliberately rejected rather than
    /// merged - silently combining two authors' book lists and deleting a row isn't something to do
    /// without the user confirming that's actually what they want (see docs/ROADMAP.md).
    /// </summary>
    NameConflict,
}

public record AuthorRenameResult(AuthorRenameOutcome Outcome, string? AuthorId = null, string? AuthorName = null, int AffectedBookCount = 0);

/// <summary>
/// Renames an author and cascades the change to every book they've written: updates the Author row
/// and, for each book where they're the primary (first-listed) author, relocates that book's
/// on-disk folder to match (mirroring IBookEditService's own folder-move rule).
/// </summary>
public interface IAuthorRenameService
{
    Task<AuthorRenameResult> RenameAsync(int authorId, string newName, CancellationToken ct = default);
}
