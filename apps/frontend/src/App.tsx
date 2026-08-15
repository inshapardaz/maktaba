import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Box, Center, Loader, Overlay, Text, Group } from "@mantine/core";
import { IconUpload } from "@tabler/icons-react";
import { getCurrentLibrary, listBooks, type BookFilters, type BookSummary } from "./api";
import { LibraryPicker } from "./components/LibraryPicker";
import { LibrarySpotlight } from "./components/LibrarySpotlight";
import { BookGrid } from "./components/BookGrid";
import { BookList } from "./components/BookList";
import { BookDetailPanel } from "./components/BookDetailPanel";
import { Sidebar, type GroupFilter, type MainView } from "./components/Sidebar";
import { TitleBar, TITLEBAR_HEIGHT } from "./components/TitleBar";
import { HomeView } from "./components/HomeView";
import { InlineReader } from "./components/InlineReader";
import { AuthorsView } from "./components/AuthorsView";
import { CollectionsView } from "./components/CollectionsView";
import { TagsView } from "./components/TagsView";
import { SeriesView } from "./components/SeriesView";
import { FilterBar, type SortDirection, type SortKey, type ViewMode } from "./components/FilterBar";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsScreen } from "./components/SettingsScreen";
import { invalidateLibraryQueries } from "./queries";
import { useDebounced } from "./useDebounced";
import { useLanguage } from "./i18n/LanguageContext";
import { ReaderLauncherProvider, type ReaderRequest } from "./ReaderLauncherContext";
import { getStoredReaderEngine, getStoredReaderOpenMode } from "./readerSettings";

const EBOOK_EXTENSIONS = [".epub", ".pdf"];

function isEbookPath(path: string): boolean {
  const lower = path.toLowerCase();
  return EBOOK_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function compareBooks(a: BookSummary, b: BookSummary, sortKey: SortKey): number {
  switch (sortKey) {
    case "title":
      return a.sortTitle.localeCompare(b.sortTitle);
    case "author":
      return (a.authors[0] ?? "").localeCompare(b.authors[0] ?? "");
    case "dateAdded":
      return a.dateAdded.localeCompare(b.dateAdded);
    case "rating":
      return a.rating - b.rating;
    case "seriesIndex":
      return (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity);
    case "lastRead":
      return (a.lastReadAt ?? "").localeCompare(b.lastReadAt ?? "");
  }
}

function sortBooks(books: BookSummary[], sortKey: SortKey, direction: SortDirection): BookSummary[] {
  const sorted = [...books];
  sorted.sort((a, b) => (direction === "asc" ? compareBooks(a, b, sortKey) : -compareBooks(a, b, sortKey)));
  return sorted;
}

// dateAdded/rating/lastRead read most-recent/highest-first by default; title/author/seriesIndex
// read alphabetically/in-order - used both by the sort popover (when the field itself changes) and
// by applyDefaultSort below (when the active group filter changes).
function defaultDirectionFor(sortKey: SortKey): SortDirection {
  return sortKey === "dateAdded" || sortKey === "rating" || sortKey === "lastRead" ? "desc" : "asc";
}

function App() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [mainView, setMainView] = useState<MainView>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sortKey, setSortKeyState] = useState<SortKey>("title");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [isDragActive, setDragActive] = useState(false);
  const [importFiles, setImportFiles] = useState<string[] | null>(null);
  const [inlineReader, setInlineReader] = useState<ReaderRequest | null>(null);

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
    () => sortBooks(booksQuery.data ?? [], sortKey, sortDirection),
    [booksQuery.data, sortKey, sortDirection],
  );

  // Picking a new sort field resets direction to that field's sensible default, whether the user
  // changed it from the sort popover or a group filter selection changed it for them below.
  const handleSortKeyChange = (key: SortKey) => {
    setSortKeyState(key);
    setSortDirection(defaultDirectionFor(key));
  };

  // Series and "currently reading"/"finished" are the two filters where the default title sort
  // stops making sense - series should read in book order, and "what am I reading" is best ordered
  // by how recently you touched it.
  const applyDefaultSort = (filter: GroupFilter | null) => {
    if (filter?.kind === "seriesId") {
      handleSortKeyChange("seriesIndex");
    } else if (filter?.kind === "readingStatus" && (filter.id === "Reading" || filter.id === "Finished")) {
      handleSortKeyChange("lastRead");
    } else if (!filter) {
      handleSortKeyChange("title");
    }
  };

  // Selecting a filter (from the sidebar or the Authors/Collections views) should always land
  // back on the library grid/list — without this, picking a filter while Settings/Authors/
  // Collections was open would silently update groupFilter behind whatever view was showing,
  // with no way back to the library short of changing libraries.
  const handleSelectFilter = (filter: GroupFilter | null) => {
    setGroupFilter(filter);
    setMainView("library");
    applyDefaultSort(filter);
  };

  const handleShowAllBooks = () => {
    setGroupFilter(null);
    setMainView("library");
    applyDefaultSort(null);
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

  // The one place that decides how "Read"/"Resume" actually opens a book - internal reader vs the
  // OS's default app for that format, and (for the internal reader) a pop-out window vs taking
  // over the main window - so BookDetailPanel/HomeView/etc. never touch window.maktaba or
  // readerSettings.ts themselves (see ReaderLauncherContext.tsx).
  const launchReader = (request: ReaderRequest) => {
    if (getStoredReaderEngine(request.format) === "external") {
      void window.maktaba.openPath(request.absolutePath);
      return;
    }
    if (getStoredReaderOpenMode() === "inline") {
      setInlineReader(request);
    } else {
      void window.maktaba.openReaderWindow(request.bookId, request.format, request.title);
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

  const hasLibrary = !!libraryQuery.data;

  return (
    <Box
      pos="relative"
      h="100vh"
      onDragOver={
        hasLibrary
          ? (e) => {
              e.preventDefault();
              setDragActive(true);
            }
          : undefined
      }
      onDragLeave={hasLibrary ? () => setDragActive(false) : undefined}
      onDrop={hasLibrary ? handleDrop : undefined}
    >
      <ReaderLauncherProvider launch={launchReader}>
        {/* AppShell.Navbar positions itself relative to the viewport (fixed), not to whatever DOM
            parent renders it — so the title bar has to be its own AppShell.Header rather than a
            sibling element above the AppShell, otherwise the navbar overlaps it instead of
            starting below it. */}
        <AppShell
          header={{ height: TITLEBAR_HEIGHT }}
          navbar={hasLibrary ? { width: sidebarCollapsed ? 56 : 232, breakpoint: 0 } : undefined}
          padding={0}
        >
          <AppShell.Header>
            <TitleBar
              hasLibrary={hasLibrary}
              mainView={mainView}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
              onOpenHome={() => setMainView("home")}
              onImport={handleImportClick}
              activeFilter={groupFilter}
              onSelect={handleSelectFilter}
              onShowAllBooks={handleShowAllBooks}
            />
          </AppShell.Header>

          {hasLibrary && (
            <AppShell.Navbar>
              <Sidebar
                activeFilter={groupFilter}
                onSelect={handleSelectFilter}
                settingsOpen={settingsOpen}
                collapsed={sidebarCollapsed}
                onOpenAuthors={() => setMainView("authors")}
                onOpenCollections={() => setMainView("collections")}
                onOpenTags={() => setMainView("tags")}
                onOpenSeries={() => setMainView("series")}
                onOpenSettings={() => setSettingsOpen(true)}
                onLibraryChanged={handleLibraryChanged}
              />
            </AppShell.Navbar>
          )}

          <AppShell.Main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
            {libraryQuery.isLoading ? (
              <Center style={{ flex: 1 }}>
                <Loader />
              </Center>
            ) : !hasLibrary ? (
              <LibraryPicker onOpened={() => void queryClient.invalidateQueries({ queryKey: ["library"] })} />
            ) : mainView === "home" ? (
              <HomeView onSelectBook={setSelectedBookId} />
            ) : mainView === "authors" ? (
              <AuthorsView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
            ) : mainView === "collections" ? (
              <CollectionsView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
            ) : mainView === "tags" ? (
              <TagsView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
            ) : mainView === "series" ? (
              <SeriesView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
            ) : (
              <>
                <FilterBar
                  format={format}
                  onFormatChange={setFormat}
                  minRating={minRating}
                  onMinRatingChange={setMinRating}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSortKeyChange={handleSortKeyChange}
                  onSortDirectionChange={setSortDirection}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  groupFilter={groupFilter}
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

        {hasLibrary && (
          <>
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
          </>
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

        {inlineReader && (
          <InlineReader
            bookId={inlineReader.bookId}
            format={inlineReader.format}
            onClose={() => setInlineReader(null)}
          />
        )}
      </ReaderLauncherProvider>
    </Box>
  );
}

export default App;
