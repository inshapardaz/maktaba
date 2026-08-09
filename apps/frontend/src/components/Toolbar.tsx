export type SortKey = "title" | "author" | "dateAdded" | "rating";
export type ViewMode = "grid" | "list";

interface ToolbarProps {
  libraryPath: string;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onImport: () => void;
  importing: boolean;
  onRescan: () => void;
  rescanning: boolean;
  bookCount: number;
}

export function Toolbar({
  libraryPath,
  sortKey,
  onSortKeyChange,
  viewMode,
  onViewModeChange,
  onImport,
  importing,
  onRescan,
  rescanning,
  bookCount,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button type="button" onClick={onImport} disabled={importing}>
          {importing ? "Importing…" : "Import Book(s)"}
        </button>
        <button type="button" onClick={onRescan} disabled={rescanning} title="Rebuild the library index from files on disk">
          {rescanning ? "Rescanning…" : "Rescan Library"}
        </button>
        <span className="book-count">{bookCount} book{bookCount === 1 ? "" : "s"}</span>
      </div>

      <div className="toolbar-right">
        <label>
          Sort by{" "}
          <select value={sortKey} onChange={(e) => onSortKeyChange(e.target.value as SortKey)}>
            <option value="title">Title</option>
            <option value="author">Author</option>
            <option value="dateAdded">Date added</option>
            <option value="rating">Rating</option>
          </select>
        </label>

        <div className="view-toggle">
          <button
            type="button"
            className={viewMode === "grid" ? "active" : ""}
            onClick={() => onViewModeChange("grid")}
          >
            Grid
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => onViewModeChange("list")}
          >
            List
          </button>
        </div>

        <span className="library-path" title={libraryPath}>
          {libraryPath}
        </span>
      </div>
    </div>
  );
}
