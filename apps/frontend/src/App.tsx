import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Box, Center, Loader, Overlay, Stack, Text, Modal, Group, Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import {
  getCurrentLibrary,
  importBook,
  listBooks,
  rescanLibrary,
  DuplicateBookError,
  type BookFilters,
  type BookSummary,
  type DuplicateAction,
  type DuplicateBookInfo,
} from "./api";
import { LibraryPicker } from "./components/LibraryPicker";
import { Toolbar, type SortKey, type ViewMode } from "./components/Toolbar";
import { BookGrid } from "./components/BookGrid";
import { BookList } from "./components/BookList";
import { BookDetailPanel } from "./components/BookDetailPanel";
import { Sidebar, type GroupFilter } from "./components/Sidebar";
import { FilterBar } from "./components/FilterBar";
import { DuplicateDialog } from "./components/DuplicateDialog";
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

function invalidateLibraryQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["books"] });
  void queryClient.invalidateQueries({ queryKey: ["authors"] });
  void queryClient.invalidateQueries({ queryKey: ["series"] });
  void queryClient.invalidateQueries({ queryKey: ["tags"] });
}

function notifyError(title: string, message: string) {
  notifications.show({
    color: "red",
    title,
    message: (
      <Stack gap={2}>
        {message.split("\n").map((line, i) => (
          <Text key={i} size="sm">
            {line}
          </Text>
        ))}
      </Stack>
    ),
    autoClose: 8000,
  });
}

function App() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [isDragActive, setDragActive] = useState(false);
  const [isImporting, setImporting] = useState(false);
  const [isRescanning, setRescanning] = useState(false);
  const [rescanConfirmOpen, setRescanConfirmOpen] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<{ filePath: string; info: DuplicateBookInfo } | null>(
    null,
  );
  const duplicateResolverRef = useRef<((action: DuplicateAction | "cancel") => void) | null>(null);

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

  function askUserForDuplicateAction(filePath: string, info: DuplicateBookInfo): Promise<DuplicateAction | "cancel"> {
    return new Promise((resolve) => {
      duplicateResolverRef.current = resolve;
      setPendingDuplicate({ filePath, info });
    });
  }

  function resolveDuplicate(action: DuplicateAction | "cancel") {
    setPendingDuplicate(null);
    duplicateResolverRef.current?.(action);
    duplicateResolverRef.current = null;
  }

  async function runImport(filePaths: string[]) {
    setImporting(true);
    const errors: string[] = [];

    filePathLoop: for (const filePath of filePaths) {
      let action: DuplicateAction | undefined;

      for (;;) {
        try {
          await importBook(filePath, action);
          break;
        } catch (err) {
          if (err instanceof DuplicateBookError) {
            const choice = await askUserForDuplicateAction(filePath, err.duplicate);
            if (choice === "cancel") {
              break filePathLoop;
            }
            action = choice;
            continue;
          }
          errors.push(`${filePath}: ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
      }
    }

    setImporting(false);
    invalidateLibraryQueries(queryClient);
    if (errors.length > 0) {
      notifyError(t("app.importFailedTitle"), errors.join("\n"));
    }
  }

  const handleImportClick = async () => {
    const files = await window.maktaba.pickEbookFiles();
    if (files.length > 0) {
      void runImport(files);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);

    const paths = Array.from(e.dataTransfer.files)
      .map((file) => window.maktaba.getPathForFile(file))
      .filter(isEbookPath);

    if (paths.length > 0) {
      void runImport(paths);
    }
  };

  const handleRescan = async () => {
    setRescanConfirmOpen(false);
    setRescanning(true);
    try {
      await rescanLibrary();
      invalidateLibraryQueries(queryClient);
    } catch (err) {
      notifyError(t("app.rescanFailedTitle"), err instanceof Error ? err.message : String(err));
    } finally {
      setRescanning(false);
    }
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
      <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 0 }} padding={0}>
        <AppShell.Header>
          <Toolbar
            libraryPath={libraryQuery.data.path}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onImport={handleImportClick}
            importing={isImporting}
            onRescan={() => setRescanConfirmOpen(true)}
            rescanning={isRescanning}
            bookCount={sortedBooks.length}
          />
        </AppShell.Header>

        <AppShell.Navbar>
          <Sidebar activeFilter={groupFilter} onSelect={setGroupFilter} />
        </AppShell.Navbar>

        <AppShell.Main style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
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

      {pendingDuplicate && (
        <DuplicateDialog
          filePath={pendingDuplicate.filePath}
          info={pendingDuplicate.info}
          onResolve={resolveDuplicate}
        />
      )}

      <Modal opened={rescanConfirmOpen} onClose={() => setRescanConfirmOpen(false)} title={t("app.rescanTitle")} centered>
        <Text size="sm" mb="md">
          {t("app.rescanBody")}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setRescanConfirmOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button color="red" onClick={() => void handleRescan()}>
            {t("app.rescanConfirm")}
          </Button>
        </Group>
      </Modal>

      {isDragActive && (
        <Overlay color="var(--mantine-color-brand-6)" backgroundOpacity={0.15} zIndex={1000}>
          <Center h="100%">
            <Group gap="xs" c="var(--mantine-color-brand-6)">
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
