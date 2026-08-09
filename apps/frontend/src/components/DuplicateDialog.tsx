import type { DuplicateAction, DuplicateBookInfo } from "../api";

interface DuplicateDialogProps {
  filePath: string;
  info: DuplicateBookInfo;
  onResolve: (action: DuplicateAction | "cancel") => void;
}

export function DuplicateDialog({ filePath, info, onResolve }: DuplicateDialogProps) {
  return (
    <div className="book-detail-overlay" onClick={() => onResolve("cancel")}>
      <div className="book-detail-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Possible duplicate</h2>
        <p>
          {info.sameContentHash
            ? "This exact file is already in your library as:"
            : "A book with the same title and author is already in your library:"}
        </p>
        <p>
          <strong>{info.existingTitle}</strong> — {info.existingAuthors.join(", ") || "Unknown author"}
        </p>
        <p className="book-detail-authors">Importing: {filePath}</p>
        <div className="form-actions">
          <button type="button" onClick={() => onResolve("cancel")}>
            Cancel remaining
          </button>
          <button type="button" onClick={() => onResolve("skip")}>
            Skip this file
          </button>
          <button type="button" onClick={() => onResolve("merge")}>
            Add as another format
          </button>
          <button type="button" onClick={() => onResolve("keep-both")}>
            Import as new book
          </button>
        </div>
      </div>
    </div>
  );
}
