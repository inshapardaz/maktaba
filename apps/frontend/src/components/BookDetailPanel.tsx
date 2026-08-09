import { useQuery } from "@tanstack/react-query";
import { getBook, coverUrl } from "../api";

interface BookDetailPanelProps {
  bookId: string;
  onClose: () => void;
}

export function BookDetailPanel({ bookId, onClose }: BookDetailPanelProps) {
  const {
    data: book,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
  });

  return (
    <div className="book-detail-overlay" onClick={onClose}>
      <div className="book-detail-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close-button" onClick={onClose}>
          ×
        </button>

        {isLoading && <p>Loading…</p>}
        {error && <p className="error-text">{error instanceof Error ? error.message : String(error)}</p>}

        {book && (
          <>
            <div className="book-detail-header">
              {book.hasCover ? (
                <img className="book-detail-cover" src={coverUrl(book.id)} alt="" />
              ) : (
                <div className="book-detail-cover-placeholder">{book.title}</div>
              )}
              <div>
                <h2>{book.title}</h2>
                <p className="book-detail-authors">{book.authors.join(", ") || "Unknown author"}</p>
                {book.seriesName && (
                  <p>
                    {book.seriesName}
                    {book.seriesIndex != null ? ` #${book.seriesIndex}` : ""}
                  </p>
                )}
                <p>
                  {"★".repeat(book.rating)}
                  {"☆".repeat(5 - book.rating)}
                </p>
              </div>
            </div>

            {book.description && <p className="book-detail-description">{book.description}</p>}

            <dl className="book-detail-meta">
              {book.publisher && (
                <>
                  <dt>Publisher</dt>
                  <dd>{book.publisher}</dd>
                </>
              )}
              {book.datePublished && (
                <>
                  <dt>Published</dt>
                  <dd>{book.datePublished}</dd>
                </>
              )}
              {book.language && (
                <>
                  <dt>Language</dt>
                  <dd>{book.language}</dd>
                </>
              )}
              {book.tags.length > 0 && (
                <>
                  <dt>Tags</dt>
                  <dd>{book.tags.join(", ")}</dd>
                </>
              )}
              {book.identifiers.length > 0 && (
                <>
                  <dt>Identifiers</dt>
                  <dd>{book.identifiers.map((i) => `${i.scheme.toUpperCase()}: ${i.value}`).join(", ")}</dd>
                </>
              )}
            </dl>

            <div className="book-detail-files">
              <h3>Files</h3>
              <ul>
                {book.files.map((f) => (
                  <li key={f.absolutePath}>
                    <span>
                      {f.format} — {(f.fileSizeBytes / 1024).toFixed(0)} KB
                    </span>
                    <button type="button" onClick={() => window.maktaba.openPath(f.absolutePath)}>
                      Open
                    </button>
                    <button type="button" onClick={() => window.maktaba.revealInFolder(f.absolutePath)}>
                      Show in folder
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
