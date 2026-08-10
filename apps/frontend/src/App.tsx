import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Box, Center, Loader, Overlay, Text, Group } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { getCurrentLibrary, listBooks, type BookFilters, type BookSummary } from "./api";
import { LibraryPicker } from "./components/LibraryPicker";
import { Toolbar, type SortKey, type ViewMode } from "./components/Toolbar";
import { BookGrid } from "./components/BookGrid";
import { BookList } from "./components/BookList";
import { BookDetailPanel } from "./components/BookDetailPanel";
import { Sidebar, type GroupFilter } from "./components/Sidebar";
import { FilterBar } from "./components/FilterBar";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsScreen } from "./components/SettingsScreen";
import { invalidateLibraryQueries } from "./queries";
import { useLanguage } from "./i18n/LanguageContext";

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

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function App() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [mainView, setMainView] = useState<"library" | "settings">("library");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [isDragActive, setDragActive] = useState(false);
  const [importFiles, setImportFiles] = useState<string[] | null>(null);

  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [groupFilter, setGroupFilter] = useState<GroupFilter | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  const filters: BookFilters = {
    search: debouncedSearch || undefined,
    format: format || undefined,
    minRating: minRating || undefined,
    authorId: groupFilter?.kind === "authorId" ? groupFilter.id : undefined,
    seriesId: groupFilter?.kind === "seriesId" ? groupFilter.id : undefined,
    tagId: groupFilter?.kind === "tagId" ? groupFilter.id : undefined,
    collectionId: groupFilter?.kind === "collectionId" ? groupFilter.id : undefined,
    readingStatus: groupFilter?.kind === "readingStatus" ? (groupFilter.id as BookFilters["readingStatus"]) : undefined,
  };

  const libraryQuery = useQuery({
    queryKey: ["library"],
    queryFn: getCurrentLibrary,
  });

  const booksQuery = useQuery({
    queryKey: ["books", filters],
    queryFn: () => listBooks(filters),
    enabled: !!libraryQuery.data,
  });

  const sortedBooks = useMemo(
    () => sortBooks(booksQuery.data ?? [], sortKey),
    [booksQuery.data, sortKey],
  );

  const contextLabel = useMemo(() => {
    if (!groupFilter) return t("toolbar.allBooks");
    const kindLabel =
      groupFilter.kind === "authorId"
        ? t("toolbar.filterAuthor")
        : groupFilter.kind === "seriesId"
          ? t("toolbar.filterSeries")
          : groupFilter.kind === "tagId"
            ? t("toolbar.filterTag")
            : groupFilter.kind === "collectionId"
              ? t("toolbar.filterCollection")
              : t("toolbar.filterStatus");
    return `${kindLabel}: ${groupFilter.name}`;
  }, [groupFilter, t]);

  const handleImportClick = async () => {
    const files = await window.maktaba.pickEbookFiles();
    if (files.length > 0) {
      setImportFiles(files);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);

    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.maktaba.getPathForFile(file))
      .filter(isEbookPath);

    if (paths.length > 0) {
      setImportFiles(paths);
    }
  };

  const handleLibraryChanged = () => {
    setSelectedBookId(null);
    setGroupFilter(null);
    setSearch("");
    setFormat("");
    setMinRating(0);
    void queryClient.invalidateQueries({ queryKey: ["library"] });
    invalidateLibraryQueries(queryClient);
    setMainView("library");
  };

  if (libraryQuery.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!libraryQuery.data) {
    return <LibraryPicker onOpened={() => void queryClient.invalidateQueries({ queryKey: ["library"] })} />;
  }

  return (
    <Box
      pos="relative"
      h="100vh"
      onDragOver={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <AppShell header={{ height: 60 }} navbar={{ width: 232, breakpoint: 0 }} padding={0}>
        <AppShell.Header>
          <Toolbar
            contextLabel={contextLabel}
            search={search}
            onSearchChange={setSearch}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onImport={handleImportClick}
            bookCount={sortedBooks.length}
          />
        </AppShell.Header>

        <AppShell.Navbar>
          <Sidebar
            activeFilter={groupFilter}
            onSelect={setGroupFilter}
            settingsActive={mainView === "settings"}
            onOpenSettings={() => setMainView("settings")}
          />
        </AppShell.Navbar>

        <AppShell.Main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          {mainView === "settings" ? (
            <SettingsScreen libraryPath={libraryQuery.data.path} onLibraryChanged={handleLibraryChanged} />
          ) : (
            <>
              <FilterBar
                format={format}
                onFormatChange={setFormat}
                minRating={minRating}
                onMinRatingChange={setMinRating}
                activeGroupLabel={groupFilter?.name ?? null}
                onClearGroup={() => setGroupFilter(null)}
              />

              {booksQuery.isLoading && (
                <Center style={{ flex: 1 }}>
                  <Loader />
                </Center>
              )}

              {booksQuery.data && sortedBooks.length === 0 && (
                <Center style={{ flex: 1 }} p="xl">
                  <Text c="dimmed" ta="center">
                    {search || format || minRating || groupFilter ? t("app.noResults") : t("app.emptyLibrary")}
                  </Text>
                </Center>
              )}

              {sortedBooks.length > 0 &&
                (viewMode === "grid" ? (
                  <BookGrid books={sortedBooks} onSelect={setSelectedBookId} />
                ) : (
                  <BookList books={sortedBooks} onSelect={setSelectedBookId} />
                ))}
            </>
          )}
        </AppShell.Main>
      </AppShell>

      {selectedBookId && (
        <BookDetailPanel
          bookId={selectedBookId}
          onClose={() => setSelectedBookId(null)}
          onRemoved={() => {
            setSelectedBookId(null);
            invalidateLibraryQueries(queryClient);
          }}
        />
      )}

      {importFiles && (
        <ImportDialog
          initialFiles={importFiles}
          onClose={() => setImportFiles(null)}
          onImported={() => invalidateLibraryQueries(queryClient)}
        />
      )}

      {isDragActive && (
        <Overlay color="var(--mantine-color-accent-7)" backgroundOpacity={0.15} zIndex={1000}>
          <Center h="100%">
            <Group gap="xs" c="var(--mantine-color-accent-7)">
              <IconUpload size={24} />
              <Text fw={600} size="lg">
                {t("app.dropToImport")}
              </Text>
            </Group>
          </Center>
        </Overlay>
      )}
    </Box>
  );
}

export default App;
