interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  format: string;
  onFormatChange: (value: string) => void;
  minRating: number;
  onMinRatingChange: (value: number) => void;
  activeGroupLabel: string | null;
  onClearGroup: () => void;
}

export function FilterBar({
  search,
  onSearchChange,
  format,
  onFormatChange,
  minRating,
  onMinRatingChange,
  activeGroupLabel,
  onClearGroup,
}: FilterBarProps) {
  return (
    <>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search title, author, series, tag…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="filter-bar">
        <label>
          Format{" "}
          <select value={format} onChange={(e) => onFormatChange(e.target.value)}>
            <option value="">All</option>
            <option value="Epub">EPUB</option>
            <option value="Pdf">PDF</option>
          </select>
        </label>

        <label>
          Min rating{" "}
          <select value={minRating} onChange={(e) => onMinRatingChange(Number(e.target.value))}>
            <option value={0}>Any</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {"★".repeat(n)}+
              </option>
            ))}
          </select>
        </label>

        {activeGroupLabel && (
          <span className="active-filter-chip">
            {activeGroupLabel}
            <button type="button" onClick={onClearGroup}>
              ×
            </button>
          </span>
        )}
      </div>
    </>
  );
}
