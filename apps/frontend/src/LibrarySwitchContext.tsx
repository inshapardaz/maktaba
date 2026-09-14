import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openLibraryById, reopenCloudLibrary, type LibraryEntry } from "./api";
import { invalidateLibraryQueries } from "./queries";

interface LibrarySwitchContextValue {
  // True from the moment a switch is requested until it (success or failure) finishes - App.tsx
  // renders a blocking "Loading…" page for the whole app while this is true, same reasoning as
  // LibrarySyncContext's isSyncing: switching a cloud-backed library pulls its database over the
  // network, which can take a couple of seconds, and the app should say so rather than sitting on
  // stale content until everything flips over at once with no visible transition.
  isSwitching: boolean;
  error: string | null;
  // True alongside `error` specifically when the backend rejected the switch because this cloud
  // library's credential was never supplied this session (ICloudCredentialCache is in-memory only,
  // cleared every backend restart - only the last-active library gets auto-reconnected on startup,
  // see App.tsx's cloudReconnectQuery). Plain "Open" has no way to collect a fresh credential, so a
  // dead-end error toast isn't actionable on its own - App.tsx uses this to also jump straight to
  // Settings -> Libraries, where the key-icon Reconnect action actually solves it.
  needsReconnect: boolean;
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
  const [needsReconnect, setNeedsReconnect] = useState(false);

  // Same recovery App.tsx's cloudReconnectQuery already does for whichever library was active at
  // startup - a plain openLibraryById(id) supplies no credential at all, so without this, switching
  // to *any* cloud library other than the one auto-reconnected at startup always failed with
  // "credentials haven't been supplied", even on the very first switch of a session, despite a
  // valid encrypted credential already sitting on disk (window.maktaba.saveCloudCredential, from
  // whenever this library was originally connected/last reconnected). Only actually falls through
  // to the bare open call - and the genuine "you need to reconnect" prompt - when nothing was ever
  // saved for this library at all (or it was, but Google/the S3 provider itself has since revoked
  // it, which the backend's own error still catches).
  async function switchTo(id: string, onSuccess?: () => void) {
    setError(null);
    setNeedsReconnect(false);
    setIsSwitching(true);
    try {
      const target = queryClient.getQueryData<LibraryEntry[]>(["libraries"])?.find((l) => l.id === id);
      const credentialJson = target && target.providerType !== "local" ? await window.maktaba.getCloudCredential(id) : null;

      if (credentialJson) {
        await reopenCloudLibrary(id, JSON.parse(credentialJson) as unknown);
      } else {
        await openLibraryById(id);
      }

      void queryClient.invalidateQueries({ queryKey: ["libraries"] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      invalidateLibraryQueries(queryClient);
      onSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setNeedsReconnect(message.includes("credentials haven't been supplied"));
    } finally {
      setIsSwitching(false);
    }
  }

  const value: LibrarySwitchContextValue = {
    isSwitching,
    error,
    needsReconnect,
    switchTo,
    dismissError: () => {
      setError(null);
      setNeedsReconnect(false);
    },
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
