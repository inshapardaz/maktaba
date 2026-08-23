import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  convertBook,
  DuplicateBookError,
  importBook,
  type DuplicateAction,
  type DuplicateBookInfo,
} from "./api";
import { invalidateLibraryQueries } from "./queries";
import { getStoredDefaultFormat, type ConvertFormat } from "./convertFormat";
import { useLanguage } from "./i18n/LanguageContext";

export type ItemStatus = "pending" | "importing" | "converting" | "done" | "error" | "skipped" | "conflict";

export interface QueueItem {
  filePath: string;
  status: ItemStatus;
  message?: string;
  // Set once the file resolves to a book (new or existing) - lets the queue show the actual book
  // title instead of just the raw file path, so it's clear *what* was added, not just *that*
  // something with this filename finished processing.
  title?: string;
  // Set only while status is "conflict" - the item stays in the list with its resolution choices
  // (skip / add as format / import as new title) rendered inline, rather than a separate blocking
  // modal that pauses the whole batch on one decision.
  duplicate?: DuplicateBookInfo;
}

// "ask" pauses on every conflict as before; the other three auto-resolve every conflict (existing
// and future, once picked - see applyDefaultToAllConflicts) the same way "resolveConflict" would,
// without needing a click per file. Part of issue #25's "ease of bulk actions" ask.
export type ConflictPolicy = DuplicateAction | "ask";

export interface ImportSummary {
  total: number;
  imported: number;
  conflicted: number;
  failed: number;
  pending: number;
}

interface ImportContextValue {
  queue: QueueItem[];
  isOpen: boolean;
  // True once the dialog's been minimized rather than closed outright - the queue keeps draining
  // either way, but only this state also keeps the on-disk folder scan running (see cancel() vs
  // minimize() below) and shows ImportStatusBar under the title bar.
  isMinimized: boolean;
  isProcessing: boolean;
  isResolving: boolean;
  scanProgress: { found: number; currentPath: string } | null;
  convertFormat: ConvertFormat;
  setConvertFormat: (format: ConvertFormat) => void;
  conflictPolicy: ConflictPolicy;
  setConflictPolicy: (policy: ConflictPolicy) => void;
  summary: ImportSummary;
  open: () => void;
  // Minimizes the dialog - scanning/importing keeps running in the background, surfaced via
  // ImportStatusBar until it's restored (open()) or cancelled (below).
  minimize: () => void;
  // Closing the dialog outright (its own X, Escape, or the footer Close button) cancels rather
  // than backgrounds: stops any folder scan in flight (native.ts's scanCancelled) and drops the
  // whole queue, since there's no way back to "review the results" once the dialog is gone.
  cancel: () => void;
  browseFiles: () => Promise<void>;
  browseFolder: () => Promise<void>;
  dropPaths: (paths: string[]) => Promise<void>;
  // Already-resolved ebook file paths (e.g. onboarding's "your folder already has ebooks") - queues
  // them directly and opens the dialog, skipping the native folder-walk resolution step above.
  enqueueFiles: (files: string[]) => void;
  resolveConflict: (filePath: string, action: DuplicateAction) => void;
  applyPolicyToAllConflicts: () => void;
  retryItem: (filePath: string) => void;
}

const ImportContext = createContext<ImportContextValue | null>(null);

const MAX_AUTO_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Only a 5xx (server-side) failure is worth retrying identically - a 4xx (bad/missing file,
// unsupported format) will fail the same way every time, so those go straight to the manual retry
// button instead (see issue #25's "make process more resilient").
function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 500;
}

// Mounted once at the app root (App.tsx) so the import queue - and any scan/import already in
// flight - survives the ImportDialog modal being minimized. That's the actual mechanism behind
// issue #25's "allow the scan to continue in background": there's nothing background-thread-like
// on the backend to hook into (see ImportService.cs - every import call is a single synchronous
// request), so "background" here means the queue keeps draining via this provider regardless of
// whether the dialog is mounted; ImportStatusBar.tsx surfaces that it's still running. Closing the
// dialog outright (cancel(), below) is different - it actually stops everything.
export function ImportProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const queueRef = useRef<QueueItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [isMinimized, setMinimized] = useState(false);
  const [isProcessing, setProcessing] = useState(false);
  const [isResolving, setResolving] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ found: number; currentPath: string } | null>(null);
  const [convertFormat, setConvertFormat] = useState<ConvertFormat>(getStoredDefaultFormat());
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("ask");
  const convertFormatRef = useRef(convertFormat);
  const conflictPolicyRef = useRef(conflictPolicy);
  const processingRef = useRef(false);
  // Bumped by cancel() so an already-running runQueue loop notices and stops picking up further
  // pending items, instead of (racily) also picking up whatever gets queued next - see runQueue.
  const generationRef = useRef(0);

  useEffect(() => {
    convertFormatRef.current = convertFormat;
  }, [convertFormat]);

  useEffect(() => {
    conflictPolicyRef.current = conflictPolicy;
  }, [conflictPolicy]);

  useEffect(
    () => window.maktaba.onResolveEbookPathsProgress((progress) => setScanProgress(progress)),
    [],
  );

  function commit() {
    setQueue([...queueRef.current]);
  }

  function updateItem(filePath: string, patch: Partial<QueueItem>) {
    queueRef.current = queueRef.current.map((item) => (item.filePath === filePath ? { ...item, ...patch } : item));
    commit();
  }

  // action is only passed when re-processing an item that's either just been resolved from its
  // inline "already exists" choices, or auto-resolved via the conflict policy below - the first
  // attempt for any file always goes through with no resolution picked yet.
  async function processOne(item: QueueItem, action?: DuplicateAction) {
    updateItem(item.filePath, { status: "importing", message: undefined, duplicate: undefined });
    let bookId: string | undefined;
    let bookTitle: string | undefined;

    let attempt = 0;
    for (;;) {
      try {
        const result = await importBook(item.filePath, action);
        bookId = result.id;
        bookTitle = result.title;
        break;
      } catch (err) {
        if (err instanceof DuplicateBookError) {
          const policy = conflictPolicyRef.current;
          if (policy === "ask") {
            // Stays in the list as its own status with inline resolution buttons instead of a
            // separate modal - and, importantly, doesn't block the queue from moving on to the
            // next pending file while this one awaits a decision.
            updateItem(item.filePath, { status: "conflict", duplicate: err.duplicate });
          } else {
            // A default conflict action is set - resolve it the same way a manual click would,
            // without waiting for one.
            await processOne(item, policy);
          }
          return;
        }
        if (isRetryable(err) && attempt < MAX_AUTO_RETRIES) {
          attempt += 1;
          await delay(RETRY_DELAY_MS * attempt);
          continue;
        }
        updateItem(item.filePath, { status: "error", message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    if (convertFormatRef.current !== "none" && bookId) {
      updateItem(item.filePath, { status: "converting" });
      try {
        await convertBook(bookId, convertFormatRef.current);
      } catch (err) {
        updateItem(item.filePath, { status: "done", title: bookTitle, message: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    // "skip" resolves to the pre-existing book without adding anything new - surfaced as its own
    // status (with an explanatory message) rather than as a plain "Done" indistinguishable from an
    // actual new addition, and it doesn't get counted as a fresh import in the summary either.
    if (action === "skip") {
      updateItem(item.filePath, {
        status: "skipped",
        title: bookTitle,
        message: t("duplicate.alreadyInLibrary", { title: bookTitle ?? "" }),
      });
      return;
    }

    updateItem(item.filePath, { status: "done", title: bookTitle });
  }

  // Fires from a conflict item's inline buttons (or a bulk "apply to all") - runs independently of
  // runQueue's main loop (which has already moved on to other pending files by the time the user
  // gets to this), so concurrent resolutions across different items are fine: updateItem only ever
  // touches the one matching filePath.
  function resolveConflict(filePath: string, action: DuplicateAction) {
    const item = queueRef.current.find((i) => i.filePath === filePath);
    if (item) {
      void processOne(item, action);
    }
  }

  function applyPolicyToAllConflicts() {
    const policy = conflictPolicyRef.current;
    if (policy === "ask") {
      return;
    }
    for (const item of queueRef.current) {
      if (item.status === "conflict") {
        void processOne(item, policy);
      }
    }
  }

  // Manual retry for a failed item (issue #25: "let user retry with a retry button" for failures
  // that auto-retry wouldn't fix, e.g. file no longer accessible) - re-queues it and lets runQueue
  // pick it back up like any other pending file.
  function retryItem(filePath: string) {
    updateItem(filePath, { status: "pending", message: undefined });
    void runQueue();
  }

  async function runQueue() {
    if (processingRef.current) {
      return;
    }
    processingRef.current = true;
    const myGeneration = generationRef.current;
    setProcessing(true);

    for (;;) {
      if (generationRef.current !== myGeneration) {
        break;
      }
      const next = queueRef.current.find((item) => item.status === "pending");
      if (!next) {
        break;
      }
      await processOne(next);
    }

    processingRef.current = false;
    setProcessing(false);
    invalidateLibraryQueries(queryClient);
  }

  function enqueueFiles(filePaths: string[]) {
    if (filePaths.length === 0) {
      return;
    }
    queueRef.current = [...queueRef.current, ...filePaths.map((filePath) => ({ filePath, status: "pending" as const }))];
    commit();
    // Respects an active minimize - dropping more files on the main window while an import is
    // already running in the background shouldn't yank the dialog back open on its own.
    if (!isMinimized) {
      setOpen(true);
    }
    void runQueue();
  }

  async function resolvePathsAndEnqueue(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    setResolving(true);
    setScanProgress(null);
    try {
      const files = await window.maktaba.resolveEbookPaths(paths);
      enqueueFiles(files);
    } finally {
      setResolving(false);
      setScanProgress(null);
    }
  }

  const browseFiles = async () => {
    const files = await window.maktaba.pickEbookFiles();
    enqueueFiles(files);
  };

  const browseFolder = async () => {
    const folders = await window.maktaba.pickEbookFolder();
    await resolvePathsAndEnqueue(folders);
  };

  const dropPaths = async (paths: string[]) => {
    await resolvePathsAndEnqueue(paths);
  };

  // See ImportContextValue.cancel - stops the native folder walk (if one's running), drops the
  // whole queue, and closes for good. Distinct from minimize(), which leaves all of this running.
  function cancel() {
    generationRef.current += 1;
    void window.maktaba.cancelResolveEbookPaths();
    queueRef.current = [];
    commit();
    setResolving(false);
    setScanProgress(null);
    setProcessing(false);
    setOpen(false);
    setMinimized(false);
  }

  function minimize() {
    setOpen(false);
    setMinimized(true);
  }

  const summary = useMemo<ImportSummary>(
    () => ({
      total: queue.length,
      imported: queue.filter((i) => i.status === "done").length,
      conflicted: queue.filter((i) => i.status === "conflict").length,
      failed: queue.filter((i) => i.status === "error").length,
      pending: queue.filter((i) => i.status === "pending" || i.status === "importing" || i.status === "converting").length,
    }),
    [queue],
  );

  const value: ImportContextValue = {
    queue,
    isOpen,
    isMinimized,
    isProcessing,
    isResolving,
    scanProgress,
    convertFormat,
    setConvertFormat,
    conflictPolicy,
    setConflictPolicy,
    summary,
    open: () => {
      setOpen(true);
      setMinimized(false);
    },
    minimize,
    cancel,
    browseFiles,
    browseFolder,
    dropPaths,
    enqueueFiles,
    resolveConflict,
    applyPolicyToAllConflicts,
    retryItem,
  };

  return <ImportContext.Provider value={value}>{children}</ImportContext.Provider>;
}

export function useImportQueue(): ImportContextValue {
  const ctx = useContext(ImportContext);
  if (!ctx) {
    throw new Error("useImportQueue must be used within ImportProvider");
  }
  return ctx;
}
