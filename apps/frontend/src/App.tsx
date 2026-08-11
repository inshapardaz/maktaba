import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Box, Center, Loader, Overlay, Text, Group } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { getCurrentLibrary, listBooks, type BookFilters, type BookSummary } from "./api";
import { LibraryPicker } from "./components/LibraryPicker";
import { Toolbar } from "./components/Toolbar";
import { LibrarySpotlight } from "./components/LibrarySpotlight";
import { BookGrid } from "./components/BookGrid";
import { BookList } from "./components/BookList";
import { BookDetailPanel } from "./components/BookDetailPanel";
import { Sidebar, type GroupFilter, type MainView } from "./components/Sidebar";
import { AuthorsView } from "./components/AuthorsView";
import { CollectionsView } from "./components/CollectionsView";
import { TagsView } from "./components/TagsView";
import { FilterBar, type SortKey, type ViewMode } from "./components/FilterBar";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsScreen } from "./components/SettingsScreen";
import { invalidateLibraryQueries } from "./queries";
import { useDebounced } from "./useDebounced";
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

function App() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [mainView, setMainView] = useState<MainView>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navbarOpen, setNavbarOpen] = useState(true);
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

  // Selecting a filter (from the sidebar or the Authors/Collections views) should always land
  // back on the library grid/list — without this, picking a filter while Settings/Authors/
  // Collections was open would silently update groupFilter behind whatever view was showing,
  // with no way back to the library short of changing libraries.
  const handleSelectFilter = (filter: GroupFilter | null) => {
    setGroupFilter(filter);
    setMainView("library");
  };

  const handleShowAllBooks = () => {
    setGroupFilter(null);
    setMainView("library");
  };

  // The Spotlight's "Search for '…'" action - a full-text search is a fresh start, so it clears
  // whatever group filter was active rather than combining with it.
  const handleDetailedSearch = (query: string) => {
    setSearch(query);
    setGroupFilter(null);
    setMainView("library");
  };

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
    setSettingsOpen(false);
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
      <AppShell
        header={{ height: 60 }}
        navbar={{ width: 232, breakpoint: 0, collapsed: { desktop: !navbarOpen, mobile: !navbarOpen } }}
        padding={0}
      >
        <AppShell.Header>
          <Toolbar
            contextLabel={contextLabel}
            onImport={handleImportClick}
            bookCount={sortedBooks.length}
            navbarOpen={navbarOpen}
            onToggleNavbar={() => setNavbarOpen((open) => !open)}
          />
        </AppShell.Header>

        <AppShell.Navbar>
          <Sidebar
            activeFilter={groupFilter}
            onSelect={handleSelectFilter}
            mainView={mainView}
            settingsOpen={settingsOpen}
            onShowAllBooks={handleShowAllBooks}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAuthors={() => setMainView("authors")}
            onOpenCollections={() => setMainView("collections")}
            onOpenTags={() => setMainView("tags")}
          />
        </AppShell.Navbar>

        <AppShell.Main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          {mainView === "authors" ? (
            <AuthorsView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
          ) : mainView === "collections" ? (
            <CollectionsView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
          ) : mainView === "tags" ? (
            <TagsView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
          ) : (
            <>
              <FilterBar
                format={format}
                onFormatChange={setFormat}
                minRating={minRating}
                onMinRatingChange={setMinRating}
                sortKey={sortKey}
                onSortKeyChange={setSortKey}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                activeGroupLabel={groupFilter?.name ?? null}
                onClearGroup={() => setGroupFilter(null)}
                searchTerm={search}
                onClearSearch={() => setSearch("")}
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

      <LibrarySpotlight
        onSelectBook={setSelectedBookId}
        onSelectFilter={handleSelectFilter}
        onSearch={handleDetailedSearch}
      />

      <SettingsScreen
        opened={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onLibraryChanged={handleLibraryChanged}
      />

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
        <Overlay color="var(--mantine-primary-color-7)" backgroundOpacity={0.15} zIndex={1000}>
          <Center h="100%">
            <Group gap="xs" c="var(--mantine-primary-color-7)">
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
