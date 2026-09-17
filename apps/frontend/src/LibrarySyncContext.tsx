import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { syncNow } from "./api";
import { invalidateLibraryQueries } from "./queries";

interface LibrarySyncContextValue {
  // True while a confirmation popup ("this will close your library, continue?") is open.
  confirming: boolean;
  // True from the moment the user confirms until the sync (success or failure) finishes - App.tsx
  // renders nothing but a blocking full-page message for the whole app while this is true, so no
  // other request can reopen a database connection mid-sync (see LibraryEndpoints.cs's
  // SqliteConnection.ClearAllPools comment for why a stray connection matters here).
  isSyncing: boolean;
  error: string | null;
  requestSync: () => void;
  confirm: () => void;
  cancel: () => void;
  dismissError: () => void;
  // Re-runs the sync without the confirmation popup - the user already confirmed once to get here,
  // so a failed sync's own "Retry" action (App.tsx's toast) shouldn't ask again. Issue #103's
  // remaining gap: previously a failed sync only left a dismissable error toast, with no way to
  // retry short of reopening Settings and clicking "Sync to cloud now" again from scratch.
  retry: () => void;
}

const LibrarySyncContext = createContext<LibrarySyncContextValue | null>(null);

// Mounted once at the app root (see main.tsx), same reasoning as RescanProvider/ImportProvider -
// living here (not as local state in LibrariesSettings, where the "Sync to cloud now" button
// lives) means the confirmation and the blocking page it leads to survive the Settings modal being
// closed, and App.tsx can render the blocking page regardless of what else is currently mounted.
export function LibrarySyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function requestSync() {
    setError(null);
    setConfirming(true);
  }

  function cancel() {
    setConfirming(false);
  }

  function runSync() {
    setIsSyncing(true);
    syncNow()
      .then(() => {
        // "Reload" the library - every query that was frozen out while the blocking page was up
        // (booksQuery included, via App.tsx's isSyncing gate) needs a fresh fetch, not just a
        // silent resume, since the backend cleared its SQLite connection pool as part of this.
        invalidateLibraryQueries(queryClient);
        void queryClient.invalidateQueries({ queryKey: ["library"] });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsSyncing(false));
  }

  function confirm() {
    setConfirming(false);
    runSync();
  }

  function retry() {
    setError(null);
    runSync();
  }

  const value: LibrarySyncContextValue = {
    confirming,
    isSyncing,
    error,
    requestSync,
    confirm,
    cancel,
    dismissError: () => setError(null),
    retry,
  };

  return <LibrarySyncContext.Provider value={value}>{children}</LibrarySyncContext.Provider>;
}

export function useLibrarySync(): LibrarySyncContextValue {
  const ctx = useContext(LibrarySyncContext);
  if (!ctx) {
    throw new Error("useLibrarySync must be used within LibrarySyncProvider");
  }
  return ctx;
}
