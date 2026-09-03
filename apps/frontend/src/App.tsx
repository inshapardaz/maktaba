import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Box, Center, Loader, Overlay, Text, Group } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "./icons";
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
import { Sidebar, SIDEBAR_DEFAULT_WIDTH, type GroupFilter, type MainView } from "./components/Sidebar";
import { TitleBar, TITLEBAR_HEIGHT } from "./components/TitleBar";
import { HomeView } from "./components/HomeView";
import { InlineReader } from "./components/InlineReader";
import { AuthorsView } from "./components/AuthorsView";
import { CollectionsView } from "./components/CollectionsView";
import { TagsView } from "./components/TagsView";
import { SeriesView } from "./components/SeriesView";
import { PublishersView } from "./components/PublishersView";
import { LanguagesView } from "./components/LanguagesView";
import { PeriodicalsView } from "./components/PeriodicalsView";
import { PeriodicalDetailView } from "./components/PeriodicalDetailView";
import { AnalyticsView } from "./components/AnalyticsView";
import { FilterBar, type SortDirection, type SortKey, type ViewMode } from "./components/FilterBar";
import { ImportDialog } from "./components/ImportDialog";
import { ImportStatusBar, IMPORT_STATUS_BAR_HEIGHT } from "./components/ImportStatusBar";
import { RescanStatusBar, RESCAN_STATUS_BAR_HEIGHT } from "./components/RescanStatusBar";
import { OnboardingTour } from "./components/OnboardingTour";
import { SettingsScreen, type SettingsTab } from "./components/SettingsScreen";
import { UpdateNotifier } from "./components/UpdateNotifier";
import { invalidateLibraryQueries } from "./queries";
import { useDebounced } from "./useDebounced";
import { useLanguage } from "./i18n/LanguageContext";
import { ReaderLauncherProvider, type ReaderRequest } from "./ReaderLauncherContext";
import { useImportQueue } from "./ImportContext";
import { useRescan } from "./RescanContext";
import { getStoredAutoTagMode, getStoredReaderEngine, getStoredReaderOpenMode } from "./readerSettings";
import { getStoredShowIssuesInGrid } from "./periodicalSettings";
import {
  getStoredSortDirection,
  getStoredSortKey,
  getStoredViewMode,
  setStoredSortDirection,
  setStoredSortKey,
  setStoredViewMode,
} from "./viewSettings";
import { hasCompletedOnboarding } from "./onboarding";

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
  const importQueue = useImportQueue();
  const rescan = useRescan();

  // Keeps the OS-level window title (taskbar/Alt-Tab) in sync with the in-app language too -
  // scoped to App.tsx (the main window only) rather than LanguageContext.tsx, since reader windows
  // share that same provider and already set document.title to the book's title themselves (see
  // main.tsx's ReaderWindow) - a blanket effect there would fight that.
  useEffect(() => {
    document.title = t("app.name");
  }, [t]);

  const [mainView, setMainView] = useState<MainView>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sortKey, setSortKeyState] = useState<SortKey>(getStoredSortKey);
  const [sortDirection, setSortDirectionState] = useState<SortDirection>(getStoredSortDirection);
  const [viewMode, setViewModeState] = useState<ViewMode>(getStoredViewMode);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  // Multi-select for issue #10's drag-onto-sidebar feature - Ctrl/Cmd+click toggles a book in/out,
  // Shift+click selects the range since lastClickedIndex, a plain click (no modifier) replaces the
  // selection with just that book and opens it as before (see handleBookClick below).
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [isDragActive, setDragActive] = useState(false);
  const [inlineReader, setInlineReader] = useState<ReaderRequest | null>(null);
  const [tourOpen, setTourOpen] = useState(false);

  // Mount-time only (deliberately empty deps) - shows the getting-started tour once on a genuine
  // first run, before a library necessarily exists yet (see OnboardingTour's mount point below,
  // outside the hasLibrary gate). Replaying it later (HelpSettings.tsx's button) just reopens this
  // same modal instance via setTourOpen, independent of this check.
  useEffect(() => {
    if (!hasCompletedOnboarding()) {
      setTourOpen(true);
    }
  }, []);

  // The standalone Help window (a separate renderer - see HelpWindow.tsx/main.ts's
  // openHelpWindow) can't reach into this window's React tree directly to reopen the tour, so its
  // "Replay Getting Started Tour" button round-trips through the main process instead - see
  // main.ts's maktaba:replay-onboarding-tour handler.
  useEffect(() => window.maktaba.onReplayOnboardingTour(() => setTourOpen(true)), []);

  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [groupFilter, setGroupFilter] = useState<GroupFilter | null>(null);
  // Which periodical's detail view (cover/description/issues grouped by date) to show within
  // mainView === "periodicals" - null shows the plain list (PeriodicalsView) instead, same
  // "toggle between list and detail within one mainView" shape as selectedBookId/BookDetailPanel.
  const [selectedPeriodicalId, setSelectedPeriodicalId] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);

  // Multi-selection is scoped to whatever book list is currently on screen - switching views
  // (library/authors/collections/...) or changing the active group filter shows a different set
  // of books entirely, so a selection carried over from before would silently apply drag/drop or
  // other multi-select actions to books the user can no longer even see.
  //
  // selectedPeriodicalId is deliberately NOT reset here (unlike before) - selecting a periodical
  // from the sidebar sets mainView to "periodicals" and selectedPeriodicalId in the same handler
  // (see handleSelectFilter's periodicalId branch below), and since both changes are batched into
  // one render, this effect would otherwise fire right after and immediately null the id back out.
  // It's reset explicitly instead, at every point that should land on the plain periodicals list.
  useEffect(() => {
    setSelectedBookIds(new Set());
    setLastClickedIndex(null);
  }, [mainView, groupFilter]);

  const filters: BookFilters = {
    search: debouncedSearch || undefined,
    format: format || undefined,
    minRating: minRating || undefined,
    authorId: groupFilter?.kind === "authorId" ? groupFilter.id : undefined,
    seriesId: groupFilter?.kind === "seriesId" ? groupFilter.id : undefined,
    tagId: groupFilter?.kind === "tagId" ? groupFilter.id : undefined,
    collectionId: groupFilter?.kind === "collectionId" ? groupFilter.id : undefined,
    periodicalId: groupFilter?.kind === "periodicalId" ? groupFilter.id : undefined,
    includeIssues: getStoredShowIssuesInGrid(),
    publisher: groupFilter?.kind === "publisher" ? groupFilter.id : undefined,
    language: groupFilter?.kind === "language" ? groupFilter.id : undefined,
    readingStatus: groupFilter?.kind === "readingStatus" ? (groupFilter.id as BookFilters["readingStatus"]) : undefined,
  };

  const libraryQuery = useQuery({
    queryKey: ["library"],
    queryFn: getCurrentLibrary,
  });

  // Falls back off the Periodicals view if this library's setting (Settings -> Libraries) gets
  // toggled off while it's the one currently showing, or a different library (with the feature
  // off) is switched to while it was showing - stale local UI state, not persisted.
  useEffect(() => {
    if (libraryQuery.data && !libraryQuery.data.periodicalsEnabled && mainView === "periodicals") {
      setMainView("library");
      setSelectedPeriodicalId(null);
    }
  }, [libraryQuery.data, mainView]);

  const booksQuery = useQuery({
    queryKey: ["books", filters],
    queryFn: () => listBooks(filters),
    enabled: !!libraryQuery.data,
  });

  const sortedBooks = useMemo(
    () => sortBooks(booksQuery.data ?? [], sortKey, sortDirection),
    [booksQuery.data, sortKey, sortDirection],
  );

  // Issue #46: Ctrl/Cmd+A selects every currently-visible book, same scope as the multi-select
  // above - only wired up while the library's book grid/list is actually on screen, and ignored
  // while focus is in a text field (search box, rename input, etc.) so their own native
  // select-all-text behavior isn't hijacked.
  useEffect(() => {
    if (mainView !== "library") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      setSelectedBookIds(new Set(sortedBooks.map((book) => book.id)));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mainView, sortedBooks]);

  // Picking a new sort field resets direction to that field's sensible default, whether the user
  // changed it from the sort popover or a group filter selection changed it for them below.
  const handleSortKeyChange = (key: SortKey) => {
    setSortKeyState(key);
    setStoredSortKey(key);
    handleSortDirectionChange(defaultDirectionFor(key));
  };

  const handleSortDirectionChange = (direction: SortDirection) => {
    setSortDirectionState(direction);
    setStoredSortDirection(direction);
  };

  const handleViewModeChange = (mode: ViewMode) => {
    setViewModeState(mode);
    setStoredViewMode(mode);
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
  //
  // Periodicals are the one exception: picking one from the sidebar should open the same
  // cover/description/year-nav detail view as PeriodicalsView's "see all" screen, not just filter
  // the plain library grid down to that periodical's issues - so this routes to mainView
  // "periodicals" instead, still keeping groupFilter in sync purely so the sidebar row highlights
  // as active while its detail view is showing.
  const handleSelectFilter = (filter: GroupFilter | null) => {
    setGroupFilter(filter);
    if (filter?.kind === "periodicalId") {
      setMainView("periodicals");
      setSelectedPeriodicalId(filter.id);
      return;
    }
    setMainView("library");
    setSelectedPeriodicalId(null);
    applyDefaultSort(filter);
  };

  const handleShowAllBooks = () => {
    setGroupFilter(null);
    setMainView("library");
    setSelectedPeriodicalId(null);
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

  // Issue #46: a marquee drag over empty space (or a plain click on empty space, reported as an
  // empty array - see dragSelect.ts) replaces the selection outright, same as a plain book click.
  const handleDragSelect = (ids: string[]) => {
    setSelectedBookIds(new Set(ids));
    setLastClickedIndex(null);
  };

  const dragDropMessageKey: Record<
    "authorId" | "authorIdAppend" | "seriesId" | "tagId" | "collectionId" | "periodicalId" | "publisher" | "language",
    { one: TranslationKey; other: TranslationKey }
  > = {
    authorId: { one: "dragDrop.authorSet_one", other: "dragDrop.authorSet_other" },
    authorIdAppend: { one: "dragDrop.author_one", other: "dragDrop.author_other" },
    seriesId: { one: "dragDrop.series_one", other: "dragDrop.series_other" },
    tagId: { one: "dragDrop.tag_one", other: "dragDrop.tag_other" },
    collectionId: { one: "dragDrop.collection_one", other: "dragDrop.collection_other" },
    periodicalId: { one: "dragDrop.periodical_one", other: "dragDrop.periodical_other" },
    publisher: { one: "dragDrop.publisher_one", other: "dragDrop.publisher_other" },
    language: { one: "dragDrop.language_one", other: "dragDrop.language_other" },
  };

  // Drop-to-edit (issue #10): dragging a book (or the active multi-selection) from the grid/list
  // onto a sidebar Authors/Series/Tags/Collections/Publisher/Language row applies that edit to
  // every dropped book. Fetches each book's current full detail first and PUTs it back with just
  // the one field changed, since the edit endpoint (same one BookEditForm uses) is a full
  // replace, not an incremental patch. Author *replaces* the book's author(s) by default (a plain
  // drop); holding Shift while dropping appends instead, alongside any existing authors (a book
  // can have co-authors) - see Sidebar.tsx's GroupSection onDrop, which reads the native
  // DragEvent's shiftKey. Series/publisher/language replace (a book has at most one of each);
  // tag/collection both add.
  const handleDropBooksOnGroup = async (
    kind: "authorId" | "seriesId" | "tagId" | "collectionId" | "periodicalId" | "publisher" | "language",
    target: { id: string; name: string },
    bookIds: string[],
    shiftKey: boolean,
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
          periodicalId: book.periodicalId,
          issueNumber: book.issueNumber,
          volumeNumber: book.volumeNumber,
          issueDate: book.issueDate,
        };

        if (kind === "authorId") {
          if (shiftKey) {
            if (!edit.authors.includes(target.name)) edit.authors = [...edit.authors, target.name];
          } else {
            edit.authors = [target.name];
          }
        } else if (kind === "seriesId") {
          // Only reset when actually changing series - re-dropping a book onto the series it's
          // already in would otherwise silently wipe its existing seriesIndex for no reason.
          if (edit.seriesName !== target.name) {
            edit.seriesName = target.name;
            edit.seriesIndex = null;
          }
        } else if (kind === "tagId") {
          if (!edit.tags.includes(target.name)) edit.tags = [...edit.tags, target.name];
        } else if (kind === "periodicalId") {
          // This *is* "convert a book into an issue" (issue #26) - dropping a book onto a
          // Periodical row sets its periodicalId, same replace-and-reset-index shape as seriesId
          // above. Reset only when actually changing periodical, so re-dropping onto the same one
          // doesn't wipe an already-set issue/volume number for no reason.
          if (edit.periodicalId !== target.id) {
            edit.periodicalId = target.id;
            edit.issueNumber = null;
            edit.volumeNumber = null;
            edit.issueDate = null;
          }
        } else if (kind === "publisher") {
          edit.publisher = target.name;
        } else if (kind === "language") {
          // Unlike publisher, target.name is a translated display label (e.g. "English") for
          // showing in the sidebar/notification - the actual Book.Language column stores the raw
          // ISO 639-1 code, which is target.id here (see Sidebar.tsx's languageDisplayName).
          edit.language = target.id;
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
    const keys = dragDropMessageKey[kind === "authorId" && shiftKey ? "authorIdAppend" : kind];
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

  // Opens ImportDialog with whatever's already queued (empty on a fresh open) rather than
  // pre-picking files here, so its own "Browse files" / "Import folder" buttons are reachable -
  // previously this jumped straight to the (files-only) OS picker and never opened the dialog if
  // it was cancelled, meaning there was no way to reach the folder-import option from the UI at all.
  const handleImportClick = () => {
    importQueue.open();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);

    const paths = Array.from(e.dataTransfer.files).map((file) => window.maktaba.getPathForFile(file));
    if (paths.length === 0) {
      return;
    }

    void importQueue.dropPaths(paths);
  };

  // The one place that decides how "Read"/"Resume" actually opens a book - internal reader vs the
  // OS's default app for that format, and (for the internal reader) a pop-out window vs taking
  // over the main window - so BookDetailPanel/HomeView/etc. never touch window.maktaba or
  // readerSettings.ts themselves (see ReaderLauncherContext.tsx).
  const launchReader = (request: ReaderRequest) => {
    // First time opening this book - not on every subsequent resume, and never overriding
    // "Finished" back to "Reading" just because it was reopened (e.g. to check something).
    // Fire-and-forget: nothing here should block or fail the actual read from opening. Only done
    // in "auto" mode - in "ask" mode this transition is left to ReaderOverlay's own
    // maybeAutoTagStatus (fires once real progress is made), so the user's preference to be asked
    // before a status changes is honored on open too, not just on finish.
    if (request.readingStatus === "Unread" && getStoredAutoTagMode() === "auto") {
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
  const showImportBar =
    importQueue.isMinimized && (importQueue.isProcessing || importQueue.isResolving || importQueue.summary.conflicted > 0);
  // Settings shows its own inline resync progress (LibrariesSettings.tsx) while it's open, so this
  // bar only needs to cover the case that used to have no progress UI at all: the resync keeps
  // running (via RescanContext) after Settings is closed.
  const showRescanBar = rescan.isRunning && !settingsOpen;
  const extraHeaderHeight = (showImportBar ? IMPORT_STATUS_BAR_HEIGHT : 0) + (showRescanBar ? RESCAN_STATUS_BAR_HEIGHT : 0);

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
      <UpdateNotifier />
      <OnboardingTour
        opened={tourOpen}
        onClose={() => setTourOpen(false)}
        hasLibrary={hasLibrary}
        onLibraryOpened={() => void queryClient.invalidateQueries({ queryKey: ["library"] })}
      />
      <ReaderLauncherProvider launch={launchReader}>
        {/* AppShell.Navbar positions itself relative to the viewport (fixed), not to whatever DOM
            parent renders it — so the title bar has to be its own AppShell.Header rather than a
            sibling element above the AppShell, otherwise the navbar overlaps it instead of
            starting below it. */}
        <AppShell
          header={{ height: TITLEBAR_HEIGHT + extraHeaderHeight }}
          navbar={hasLibrary ? { width: sidebarWidth, breakpoint: 0 } : undefined}
          padding={0}
        >
          <AppShell.Header style={{ backgroundColor: "var(--app-surface)" }}>
            <TitleBar
              hasLibrary={hasLibrary}
              mainView={mainView}
              onOpenHome={() => setMainView("home")}
              onImport={handleImportClick}
              activeFilter={groupFilter}
              onSelect={handleSelectFilter}
              onShowAllBooks={handleShowAllBooks}
              settingsOpen={settingsOpen}
              onOpenSettings={(tab) => {
                setSettingsTab(tab);
                setSettingsOpen(true);
              }}
              onOpenAnalytics={() => setMainView("analytics")}
              actionsHidden={!!inlineReader}
            />
            {showImportBar && <ImportStatusBar />}
            {showRescanBar && <RescanStatusBar />}
          </AppShell.Header>

          {hasLibrary && (
            <AppShell.Navbar style={{ backgroundColor: "var(--app-surface)" }}>
              <Sidebar
                activeFilter={groupFilter}
                onSelect={handleSelectFilter}
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
                onOpenAuthors={() => setMainView("authors")}
                onOpenCollections={() => setMainView("collections")}
                onOpenTags={() => setMainView("tags")}
                onOpenSeries={() => setMainView("series")}
                onOpenPeriodicals={() => {
                  setMainView("periodicals");
                  setSelectedPeriodicalId(null);
                  setGroupFilter(null);
                }}
                onOpenPublishers={() => setMainView("publishers")}
                onOpenLanguages={() => setMainView("languages")}
                onOpenSettings={(tab) => {
                  setSettingsTab(tab);
                  setSettingsOpen(true);
                }}
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
                    importQueue.enqueueFiles(filesToImport);
                  }
                }}
              />
            ) : mainView === "home" ? (
              <HomeView onSelectBook={setSelectedBookId} onSelectFilter={handleSelectFilter} />
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
            ) : mainView === "languages" ? (
              <LanguagesView onSelect={handleSelectFilter} onBack={() => setMainView("library")} />
            ) : mainView === "periodicals" ? (
              selectedPeriodicalId ? (
                <PeriodicalDetailView
                  periodicalId={selectedPeriodicalId}
                  onBack={() => setSelectedPeriodicalId(null)}
                  onSelectBook={setSelectedBookId}
                />
              ) : (
                <PeriodicalsView onOpen={setSelectedPeriodicalId} onBack={() => setMainView("library")} />
              )
            ) : mainView === "analytics" ? (
              <AnalyticsView onBack={() => setMainView("library")} />
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
                  onSortDirectionChange={handleSortDirectionChange}
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
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
                    <BookGrid
                      books={sortedBooks}
                      selectedIds={selectedBookIds}
                      onSelect={handleBookClick}
                      onDragSelect={handleDragSelect}
                    />
                  ) : (
                    <BookList
                      books={sortedBooks}
                      selectedIds={selectedBookIds}
                      onSelect={handleBookClick}
                      onDragSelect={handleDragSelect}
                    />
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
              initialTab={settingsTab}
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

            <ImportDialog />
          </>
        )}

        {isDragActive && (
          // pointer-events: none is load-bearing, not cosmetic - without it, this overlay (which
          // renders directly under the cursor the instant isDragActive flips true) becomes the
          // browser's drag hit-test target itself. dragenter/dragleave bubble and fire on that
          // kind of parent -> child hit-target change (unlike mouseenter/mouseleave), so the
          // outer Box's onDragLeave (below) would fire, flipping isDragActive back to false,
          // unmounting this overlay, which hands the hit-test back to Box and fires onDragOver
          // again - an infinite mount/unmount flicker several times a second. Excluding this
          // whole layer from hit-testing keeps every drag event targeting Box throughout.
          <Overlay color="var(--mantine-primary-color-7)" backgroundOpacity={0.15} zIndex={1000} style={{ pointerEvents: "none" }}>
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
