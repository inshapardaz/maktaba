import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Box, Center, Loader, Overlay, Text, Group } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import {
  getBook,
  getCurrentLibrary,
  listBooks,
  updateBook,
  updateBookStatus,
  type BookEditRequest,
  type BookFilters,
  type BookSummary,
} from "./api";
import { isBookDrag } from "./bookDrag";
import type { TranslationKey } from "./i18n/translations";
import { LibraryPicker } from "./components/LibraryPicker";
import { LoadingContent } from "./components/BackendGate";
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
import { PublishersView } from "./components/PublishersView";
import { FilterBar, type SortDirection, type SortKey, type ViewMode } from "./components/FilterBar";
import { ImportDialog } from "./components/ImportDialog";
import { SettingsScreen } from "./components/SettingsScreen";
import { invalidateLibraryQueries } from "./queries";
import { useDebounced } from "./useDebounced";
import { useLanguage } from "./i18n/LanguageContext";
import { ReaderLauncherProvider, type ReaderRequest } from "./ReaderLauncherContext";
import { getStoredReaderEngine, getStoredReaderOpenMode } from "./readerSettings";

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

  // Keeps the OS-level window title (taskbar/Alt-Tab) in sync with the in-app language too -
  // scoped to App.tsx (the main window only) rather than LanguageContext.tsx, since reader windows
  // share that same provider and already set document.title to the book's title themselves (see
  // main.tsx's ReaderWindow) - a blanket effect there would fight that.
  useEffect(() => {
    document.title = t("app.name");
  }, [t]);

  const [mainView, setMainView] = useState<MainView>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sortKey, setSortKeyState] = useState<SortKey>("title");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  // Multi-select for issue #10's drag-onto-sidebar feature - Ctrl/Cmd+click toggles a book in/out,
  // Shift+click selects the range since lastClickedIndex, a plain click (no modifier) replaces the
  // selection with just that book and opens it as before (see handleBookClick below).
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
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
    publisher: groupFilter?.kind === "publisher" ? groupFilter.id : undefined,
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

  // Ctrl/Cmd+click toggles a book in/out of the multi-selection (used by issue #10's drag-onto-
  // sidebar feature - see handleDropBooksOnGroup below); Shift+click selects the range since
  // lastClickedIndex; a plain click replaces the selection with just this book and opens it, same
  // as every click did before this feature existed.
  const handleBookClick = (id: string, index: number, event: React.MouseEvent) => {
    if (event.shiftKey && lastClickedIndex !== null) {
      const [start, end] = [lastClickedIndex, index].sort((a, b) => a - b);
      const rangeIds = sortedBooks.slice(start, end + 1).map((b) => b.id);
      setSelectedBookIds((prev) => new Set([...prev, ...rangeIds]));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedBookIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setLastClickedIndex(index);
      return;
    }
    setSelectedBookIds(new Set());
    setLastClickedIndex(index);
    setSelectedBookId(id);
  };

  const dragDropMessageKey: Record<
    "authorId" | "seriesId" | "tagId" | "collectionId",
    { one: TranslationKey; other: TranslationKey }
  > = {
    authorId: { one: "dragDrop.author_one", other: "dragDrop.author_other" },
    seriesId: { one: "dragDrop.series_one", other: "dragDrop.series_other" },
    tagId: { one: "dragDrop.tag_one", other: "dragDrop.tag_other" },
    collectionId: { one: "dragDrop.collection_one", other: "dragDrop.collection_other" },
  };

  // Drop-to-edit (issue #10): dragging a book (or the active multi-selection) from the grid/list
  // onto a sidebar Authors/Series/Tags/Collections row applies that edit to every dropped book.
  // Fetches each book's current full detail first and PUTs it back with just the one field
  // changed, since the edit endpoint (same one BookEditForm uses) is a full replace, not an
  // incremental patch. Author adds alongside existing authors (a book can have co-authors);
  // series replaces (a book has at most one); tag/collection both add.
  const handleDropBooksOnGroup = async (
    kind: "authorId" | "seriesId" | "tagId" | "collectionId",
    target: { id: string; name: string },
    bookIds: string[],
  ) => {
    const results = await Promise.allSettled(
      bookIds.map(async (bookId) => {
        const book = await getBook(bookId);
        const edit: BookEditRequest = {
          title: book.title,
          authors: book.authors,
          language: book.language,
          publisher: book.publisher,
          publishedDate: book.datePublished,
          description: book.description,
          rating: book.rating,
          seriesName: book.seriesName,
          seriesIndex: book.seriesIndex,
          tags: book.tags,
          collectionIds: book.collections.map((c) => c.id),
        };

        if (kind === "authorId") {
          if (!edit.authors.includes(target.name)) edit.authors = [...edit.authors, target.name];
        } else if (kind === "seriesId") {
          // Only reset when actually changing series - re-dropping a book onto the series it's
          // already in would otherwise silently wipe its existing seriesIndex for no reason.
          if (edit.seriesName !== target.name) {
            edit.seriesName = target.name;
            edit.seriesIndex = null;
          }
        } else if (kind === "tagId") {
          if (!edit.tags.includes(target.name)) edit.tags = [...edit.tags, target.name];
        } else {
          if (!edit.collectionIds.includes(target.id)) edit.collectionIds = [...edit.collectionIds, target.id];
        }

        await updateBook(bookId, edit);
      }),
    );

    invalidateLibraryQueries(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["book"] });
    setSelectedBookIds(new Set());

    const failed = results.filter((r) => r.status === "rejected").length;
    const succeeded = bookIds.length - failed;
    const keys = dragDropMessageKey[kind];
    notifications.show({
      color: failed > 0 ? "yellow" : "green",
      title: target.name,
      message:
        failed > 0
          ? t("dragDrop.partialFailure", { done: succeeded, total: bookIds.length })
          : t(succeeded === 1 ? keys.one : keys.other, { count: succeeded, name: target.name }),
    });
  };

  // The Spotlight's "Search for '…'" action - a full-text search is a fresh start, so it clears
  // whatever group filter was active rather than combining with it.
  const handleDetailedSearch = (query: string) => {
    setSearch(query);
    setGroupFilter(null);
    setMainView("library");
  };

  // Opens ImportDialog with an empty queue rather than pre-picking files here, so its own
  // "Browse files" / "Import folder" buttons are reachable - previously this jumped straight to
  // the (files-only) OS picker and never opened the dialog if it was cancelled, meaning there was
  // no way to reach the folder-import option from the UI at all.
  const handleImportClick = () => {
    setImportFiles([]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);

    const paths = Array.from(e.dataTransfer.files).map((file) => window.maktaba.getPathForFile(file));
    if (paths.length === 0) {
      return;
    }

    void window.maktaba.resolveEbookPaths(paths).then((files) => {
      if (files.length > 0) {
        setImportFiles(files);
      }
    });
  };

  // The one place that decides how "Read"/"Resume" actually opens a book - internal reader vs the
  // OS's default app for that format, and (for the internal reader) a pop-out window vs taking
  // over the main window - so BookDetailPanel/HomeView/etc. never touch window.maktaba or
  // readerSettings.ts themselves (see ReaderLauncherContext.tsx).
  const launchReader = (request: ReaderRequest) => {
    // First time opening this book - not on every subsequent resume, and never overriding
    // "Finished" back to "Reading" just because it was reopened (e.g. to check something).
    // Fire-and-forget: nothing here should block or fail the actual read from opening.
    if (request.readingStatus === "Unread") {
      void updateBookStatus(request.bookId, "Reading").then(() => {
        invalidateLibraryQueries(queryClient);
        void queryClient.invalidateQueries({ queryKey: ["book", request.bookId] });
      });
    }

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
    setMainView("home");
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
              // A book being dragged onto a sidebar group row (issue #10) is not a file import -
              // skip so the "Drop EPUB/PDF files to import" overlay doesn't cover the sidebar
              // while that drag is in progress. Sidebar's own rows still get their drop handling
              // independently (each nested element's dragover/drop fires regardless of what an
              // ancestor's handler does).
              if (isBookDrag(e)) return;
              e.preventDefault();
              setDragActive(true);
            }
          : undefined
      }
      onDragLeave={hasLibrary ? () => setDragActive(false) : undefined}
      onDrop={
        hasLibrary
          ? (e) => {
              if (isBookDrag(e)) return;
              handleDrop(e);
            }
          : undefined
      }
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
              actionsHidden={!!inlineReader}
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
                onOpenPublishers={() => setMainView("publishers")}
                onOpenSettings={() => setSettingsOpen(true)}
                onLibraryChanged={handleLibraryChanged}
                onDropBooks={handleDropBooksOnGroup}
              />
            </AppShell.Navbar>
          )}

          <AppShell.Main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
            {libraryQuery.isLoading ? (
              <LoadingContent message={t("app.loading")} />
            ) : !hasLibrary ? (
              <LibraryPicker
                onOpened={(_path, filesToImport) => {
                  void queryClient.invalidateQueries({ queryKey: ["library"] });
                  if (filesToImport.length > 0) {
                    setImportFiles(filesToImport);
                  }
                }}
              />
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
            ) : mainView === "publishers" ? (
              <PublishersView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
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
                    <BookGrid books={sortedBooks} selectedIds={selectedBookIds} onSelect={handleBookClick} />
                  ) : (
                    <BookList books={sortedBooks} selectedIds={selectedBookIds} onSelect={handleBookClick} />
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
