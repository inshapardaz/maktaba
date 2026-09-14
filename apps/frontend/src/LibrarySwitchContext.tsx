import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openLibraryById } from "./api";
import { invalidateLibraryQueries } from "./queries";

interface LibrarySwitchContextValue {
  // True from the moment a switch is requested until it (success or failure) finishes - App.tsx
  // renders a blocking "Loading…" page for the whole app while this is true, same reasoning as
  // LibrarySyncContext's isSyncing: switching a cloud-backed library pulls its database over the
  // network, which can take a couple of seconds, and the app should say so rather than sitting on
  // stale content until everything flips over at once with no visible transition.
  isSwitching: boolean;
  error: string | null;
  // onSuccess is caller-supplied (rather than baked in here) because what should happen after a
  // successful switch differs by caller - App.tsx's handleLibraryChanged resets a bunch of its own
  // view state (selection, nav history, current view) that this context has no business knowing
  // about, on top of the query invalidation this function always does regardless of who called it.
  switchTo: (id: string, onSuccess?: () => void) => void;
  dismissError: () => void;
}

const LibrarySwitchContext = createContext<LibrarySwitchContextValue | null>(null);

// Mounted once at the app root (see main.tsx), same reasoning as LibrarySyncProvider/
// RescanProvider/ImportProvider - both LibrarySwitcher.tsx's sidebar dropdown and
// LibrariesSettings.tsx's "Open" button call the same switchTo here instead of each running their
// own openLibraryById mutation, so the loading/error UX (and the query invalidations that follow a
// successful switch) live in exactly one place rather than two copies that could drift apart.
export function LibrarySwitchProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchTo(id: string, onSuccess?: () => void) {
    setError(null);
    setIsSwitching(true);
    openLibraryById(id)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["libraries"] });
        void queryClient.invalidateQueries({ queryKey: ["library"] });
        invalidateLibraryQueries(queryClient);
        onSuccess?.();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsSwitching(false));
  }

  const value: LibrarySwitchContextValue = {
    isSwitching,
    error,
    switchTo,
    dismissError: () => setError(null),
  };

  return <LibrarySwitchContext.Provider value={value}>{children}</LibrarySwitchContext.Provider>;
}

export function useLibrarySwitch(): LibrarySwitchContextValue {
  const ctx = useContext(LibrarySwitchContext);
  if (!ctx) {
    throw new Error("useLibrarySwitch must be used within LibrarySwitchProvider");
  }
  return ctx;
}
