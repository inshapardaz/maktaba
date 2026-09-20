namespace Maktaba.Core.Services;

public enum BookTransferOutcome
{
    Success,
    SourceBookNotFound,
    TargetLibraryNotFound,
    SameLibrary,
    UnsupportedProvider,
    CredentialMissing,
    Failed,
}

/// <param name="Outcome">See <see cref="BookTransferOutcome"/>.</param>
/// <param name="NewBookId">The book's new id in the target library, once <see cref="Outcome"/> is
/// <see cref="BookTransferOutcome.Success"/>.</param>
/// <param name="ErrorMessage">A human-readable message for <see cref="BookTransferOutcome.Failed"/>
/// or <see cref="BookTransferOutcome.CredentialMissing"/>.</param>
/// <param name="SourceRemoval">Set only when the transfer was a move (<c>deleteFromSource: true</c>)
/// and the copy into the target library succeeded - the same
/// <see cref="BookRemovalResult"/> <see cref="IBookRemovalService.RemoveAsync"/> itself returns, so
/// the caller (the endpoint, then the frontend) can trash the source's local folder exactly the way
/// a plain delete already does.</param>
public record BookTransferResult(
    BookTransferOutcome Outcome,
    int? NewBookId = null,
    string? ErrorMessage = null,
    BookRemovalResult? SourceRemoval = null);

/// <summary>
/// Copies (or moves) a book from the currently active library into a different registered library -
/// creating any Author/Tag/Collection/Series/Periodical the target library doesn't already have (by
/// name, case-insensitively, same matching rule <see cref="EntityResolvers"/>-equivalent lookups use
/// elsewhere) - along with the book's cover and file contents. Neither library needs to be the
/// currently *open* one in the frontend sense: the source is always the currently active library
/// (the book being acted on has to be visible to look at it in the first place), the target is
/// resolved independently via <see cref="IStorageProviderFactory.CreateForProvider"/> without
/// switching the app's active library at all.
/// </summary>
public interface IBookLibraryTransferService
{
    Task<BookTransferResult> TransferAsync(
        int bookId, string targetLibraryId, bool deleteFromSource, CancellationToken ct = default);
}
