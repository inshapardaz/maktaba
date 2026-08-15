import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Center, Loader, useComputedColorScheme } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import {
  Reader,
  LOCALES,
  type ReaderSettings,
  type ReaderSource,
  type ReadingProgress as QariReadingProgress,
} from "@inshapardaz/qari";
import type { ReaderError, FontFamily, ReadingProgressRecord } from "@inshapardaz/qari/models";
import type { CustomStoreAdapter, CustomNoteStoreAdapter, CustomProgressStoreAdapter } from "@inshapardaz/qari/interfaces";
import {
  getBook,
  getBookFile,
  listBookmarks,
  saveBookmark,
  deleteBookmark,
  listNotes,
  saveNote,
  deleteNote,
  getReadingProgress,
  saveReadingProgress,
} from "../api";
import { useLanguage } from "../i18n/LanguageContext";

// ISO 639-1 codes (matches BookEditForm's language field) for languages conventionally written
// right-to-left - checked against the primary subtag only, so a regional variant like "ar-EG"
// still matches.
const RTL_LANGUAGE_CODES = new Set(["ar", "he", "fa", "ur", "ps", "sd", "yi", "ckb"]);

function isRtlLanguageCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const primary = code.trim().toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGE_CODES.has(primary);
}

interface ReaderOverlayProps {
  bookId: string;
  format: "Epub" | "Pdf";
  // Only passed by InlineReader.tsx (the "render in the main window" mode) - the pop-out
  // BrowserWindow case (main.tsx's ReaderWindow) has no in-app "previous screen" to return to, so
  // it leaves this unset and relies on the native window chrome to close instead. qari shows its
  // own close button in the reader header whenever this is provided.
  onClose?: () => void;
}

// A device-wide reading preference (theme/font/layout), not per-book or synced data - matches the
// plain localStorage convention already used by ThemeColorContext.tsx and i18n/LanguageContext.tsx.
const SETTINGS_STORAGE_KEY = "maktaba-reader-settings";

function loadStoredSettings(): ReaderSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ReaderSettings) : {};
  } catch {
    return {};
  }
}

// Avoids a DB write on every single page-turn tick while someone holds an arrow key.
const PROGRESS_SAVE_DEBOUNCE_MS = 1500;

// Debounces a save, coalescing rapid calls into one - but flushes immediately on unmount instead
// of just cancelling, so the very last pending value (e.g. the page the user was on right as they
// closed the reader window) is never silently dropped.
function useDebouncedSave<T>(save: (value: T) => void, delayMs: number): (value: T) => void {
  const pendingRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current !== null) {
      const value = pendingRef.current;
      pendingRef.current = null;
      save(value);
    }
  }, [save]);

  useEffect(() => () => flush(), [flush]);

  return useCallback(
    (value: T) => {
      pendingRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs],
  );
}

export function ReaderOverlay({ bookId, format, onClose }: ReaderOverlayProps) {
  const { t, language } = useLanguage();
  const colorScheme = useComputedColorScheme("light");
  const [readerError, setReaderError] = useState<ReaderError | null>(null);

  // theme/scroll/columns/etc are fully controlled props on <Reader> - it has no internal fallback
  // state, so its own in-reader theme/layout buttons only take effect if we feed their
  // onSettingsChange result back in as the next value of this state (this is the fix for "can't
  // change theme/view type in the reader"). colorScheme/language are only consulted once, as the
  // default for a first-ever launch - not re-applied on every render.
  const [settings, setSettings] = useState<ReaderSettings>(() => ({
    theme: colorScheme === "dark" ? "dark" : "light",
    fontFamily: language === "ur" ? "nastaliq" : "serif",
    ...loadStoredSettings(),
  }));

  const handleSettingsChange = useCallback((partial: ReaderSettings) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  // staleTime/refetchOnWindowFocus disabled - the book's bytes are immutable for the lifetime of
  // this reader window, so React Query's default focus-refetch would otherwise re-download and
  // re-parse the whole book (a new ArrayBuffer -> new `source` -> qari reloads it) every time this
  // window (or the main library window) regains focus.
  const fileQuery = useQuery({
    queryKey: ["bookFile", bookId, format],
    queryFn: () => getBookFile(bookId, format),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Only needed to pick a PDF's reading direction (see `direction` below) - EPUBs already carry
  // their own page-progression-direction metadata that qari's "auto" detection reads directly, but
  // PdfMetadataExtractor never populates Language (PDF info dicts don't reliably carry it), so a
  // PDF's language is a case-by-case book-record field (often set by hand via BookEditForm) rather
  // than something "auto" can detect from the file itself.
  const bookQuery = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => getBook(bookId),
    enabled: format === "Pdf",
    staleTime: Infinity,
  });

  // Reader reloads the whole book whenever this object's *reference* changes (its internal
  // load-book effect depends on `source` by identity) - memoized so a settings/progress-driven
  // re-render of this component doesn't create a new object and trigger a spurious reload.
  const source = useMemo<ReaderSource>(
    () => (format === "Epub" ? { type: "epub", data: fileQuery.data! } : { type: "pdf", data: fileQuery.data! }),
    [format, fileQuery.data],
  );

  // load/list both resolve to this book's bookmarks/notes regardless of arguments - the adapter
  // instance is already scoped to this one book via the bookId closure, independent of whatever
  // internal book id qari itself tracks. save() is also how qari persists a rename (it just calls
  // save() again with the same id), so the backend PUT is an upsert keyed by that id.
  const bookmarkAdapter = useMemo<CustomStoreAdapter>(
    () => ({
      save: (bookmark) => saveBookmark(bookId, bookmark),
      load: () => listBookmarks(bookId).then((items) => items.map((item) => ({ ...item, bookId }))),
      list: () => listBookmarks(bookId).then((items) => items.map((item) => ({ ...item, bookId }))),
      remove: (bookmarkId) => deleteBookmark(bookId, bookmarkId),
    }),
    [bookId],
  );

  const noteAdapter = useMemo<CustomNoteStoreAdapter>(
    () => ({
      save: (note) => saveNote(bookId, note),
      load: () => listNotes(bookId).then((items) => items.map((item) => ({ ...item, bookId }))),
      list: () => listNotes(bookId).then((items) => items.map((item) => ({ ...item, bookId }))),
      remove: (noteId) => deleteNote(bookId, noteId),
    }),
    [bookId],
  );

  // Display snapshot (currentChapter/totalChapters/currentPage/totalPages/chapterTitle/percentage)
  // shown in BookDetailPanel - fires on every page turn, so it's debounced the same way as the
  // resume anchor below. Distinct from progressAdapter: qari calls onProgressChange for display
  // purposes only, it doesn't drive resume-on-reopen (progressAdapter does that).
  const scheduleProgressSave = useDebouncedSave<QariReadingProgress>(
    (progress) => void saveReadingProgress(bookId, progress),
    PROGRESS_SAVE_DEBOUNCE_MS,
  );

  // The resume anchor (chapterId + a within-chapter offset) qari itself resolves back to a page
  // when the book is reopened - see progressAdapter.load below. Also fires on every page turn.
  const schedulePositionSave = useDebouncedSave<Pick<ReadingProgressRecord, "chapterId" | "position" | "percentage">>(
    (position) => void saveReadingProgress(bookId, position),
    PROGRESS_SAVE_DEBOUNCE_MS,
  );

  const progressAdapter = useMemo<CustomProgressStoreAdapter>(
    () => ({
      save: (record) => {
        schedulePositionSave({ chapterId: record.chapterId, position: record.position, percentage: record.percentage });
        // Optimistic: the actual write happens on the debounce's own schedule (see
        // useDebouncedSave), not synchronously here - qari only awaits this to know whether to
        // fall back to its own localStorage store, not to confirm the write landed.
        return Promise.resolve();
      },
      load: () =>
        getReadingProgress(bookId).then((progress) =>
          progress?.chapterId != null && progress.position != null
            ? {
                bookId,
                chapterId: progress.chapterId,
                position: progress.position,
                percentage: progress.percentage,
                updatedAt: progress.updatedAt,
              }
            : null,
        ),
      // qari's own UI never calls remove() today (there's no "reset progress" action yet) - a
      // no-op keeps the adapter contract satisfied without inventing a DELETE endpoint for a call
      // path nothing currently reaches.
      remove: () => Promise.resolve(),
    }),
    [bookId, schedulePositionSave],
  );

  // PDFs have no reliable in-file signal for qari's own "auto" direction detection to key off, so
  // once we know the book's language, force it explicitly - RTL for a book tagged with an RTL
  // language, LTR otherwise. Leave "auto" in place (its EPUB metadata/character-frequency
  // detection) whenever the language is unknown, rather than guessing LTR and getting it wrong for
  // an RTL book nobody's tagged yet.
  const direction = format === "Pdf" && bookQuery.data?.language ? (isRtlLanguageCode(bookQuery.data.language) ? "rtl" : "ltr") : "auto";

  return (
    <Box pos="fixed" top={0} left={0} right={0} bottom={0} bg="var(--mantine-color-body)" style={{ zIndex: 2000 }}>
      {fileQuery.isLoading && (
        <Center h="100%">
          <Loader />
        </Center>
      )}

      {fileQuery.isError && (
        <Center h="100%" p="xl">
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("reader.loadErrorTitle")} maw={480}>
            {fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error)}
          </Alert>
        </Center>
      )}

      {readerError && (
        <Center h="100%" p="xl">
          <Alert color="red" icon={<IconAlertCircle size={18} />} title={t("reader.errorTitle")} maw={480}>
            {readerError.message}
          </Alert>
        </Center>
      )}

      {fileQuery.data && !readerError && (
        <Reader
          source={source}
          {...settings}
          fontFamily={settings.fontFamily as FontFamily | undefined}
          direction={direction}
          translations={LOCALES[language]}
          showCloseButton={!!onClose}
          onClose={onClose}
          bookmarkAdapter={bookmarkAdapter}
          noteAdapter={noteAdapter}
          progressAdapter={progressAdapter}
          onSettingsChange={handleSettingsChange}
          onProgressChange={scheduleProgressSave}
          onError={(event) => setReaderError(event)}
        />
      )}
    </Box>
  );
}
