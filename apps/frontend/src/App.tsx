import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentLibrary, importBook, listBooks, type BookSummary } from "./api";
import { LibraryPicker } from "./components/LibraryPicker";
import { Toolbar, type SortKey, type ViewMode } from "./components/Toolbar";
import { BookGrid } from "./components/BookGrid";
import { BookList } from "./components/BookList";
import { BookDetailPanel } from "./components/BookDetailPanel";
import "./App.css";

const EBOOK_EXTENSIONS = [".epub", ".pdf"];

function isEbookPath(path: string): boolean {
  const lower = path.toLowerCase();
  return EBOOK_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function sortBooks(books: BookSummary[], sortKey: SortKey): BookSummary[] {
  const sorted = [...books];
  switch (sortKey) {
    case "title":
      return sorted.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
    case "author":
      return sorted.sort((a, b) => (a.authors[0] ?? "").localeCompare(b.authors[0] ?? ""));
    case "dateAdded":
      return sorted.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
    case "rating":
      return sorted.sort((a, b) => b.rating - a.rating);
  }
}

function App() {
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [isDragActive, setDragActive] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const libraryQuery = useQuery({
    queryKey: ["library"],
    queryFn: getCurrentLibrary,
  });

  const booksQuery = useQuery({
    queryKey: ["books"],
    queryFn: listBooks,
    enabled: !!libraryQuery.data,
  });

  const importMutation = useMutation({
    mutationFn: async (filePaths: string[]) => {
      const errors: string[] = [];
      for (const filePath of filePaths) {
        try {
          await importBook(filePath);
        } catch (err) {
          errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return errors;
    },
    onSuccess: (errors) => {
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      setImportError(errors.length > 0 ? errors.join("\n") : null);
    },
  });

  const sortedBooks = useMemo(
    () => sortBooks(booksQuery.data ?? [], sortKey),
    [booksQuery.data, sortKey],
  );

  const handleImportClick = async () => {
    const files = await window.maktaba.pickEbookFiles();
    if (files.length > 0) {
      importMutation.mutate(files);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);

    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.maktaba.getPathForFile(file))
      .filter(isEbookPath);

    if (paths.length > 0) {
      importMutation.mutate(paths);
    }
  };

  if (libraryQuery.isLoading) {
    return <div className="centered-message">Loading…</div>;
  }

  if (!libraryQuery.data) {
    return <LibraryPicker onOpened={() => void queryClient.invalidateQueries({ queryKey: ["library"] })} />;
  }

  return (
    <div
      className={`app-shell${isDragActive ? " drag-active" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <Toolbar
        libraryPath={libraryQuery.data.path}
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onImport={handleImportClick}
        importing={importMutation.isPending}
        bookCount={sortedBooks.length}
      />

      {importError && (
        <pre className="error-text import-error">
          {importError}
          <button type="button" onClick={() => setImportError(null)}>
            Dismiss
          </button>
        </pre>
      )}

      {booksQuery.isLoading && <div className="centered-message">Loading books…</div>}

      {booksQuery.data && sortedBooks.length === 0 && (
        <div className="centered-message">
          No books yet. Click "Import Book(s)" or drag EPUB/PDF files onto this window.
        </div>
      )}

      {sortedBooks.length > 0 &&
        (viewMode === "grid" ? (
          <BookGrid books={sortedBooks} onSelect={setSelectedBookId} />
        ) : (
          <BookList books={sortedBooks} onSelect={setSelectedBookId} />
        ))}

      {selectedBookId && (
        <BookDetailPanel bookId={selectedBookId} onClose={() => setSelectedBookId(null)} />
      )}

      {isDragActive && <div className="drag-overlay">Drop EPUB/PDF files to import</div>}
    </div>
  );
}

export default App;
