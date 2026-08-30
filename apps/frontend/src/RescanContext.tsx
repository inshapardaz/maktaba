import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getRescanProgress, resyncLibrary, type RescanProgress } from "./api";
import { invalidateLibraryQueries } from "./queries";

interface RescanTarget {
  id: string;
  name: string;
  isActive: boolean;
}

interface RescanContextValue {
  isRunning: boolean;
  libraryId: string | null;
  libraryName: string | null;
  progress: RescanProgress | null;
  error: string | null;
  // onActiveLibraryChanged mirrors App.tsx's handleLibraryChanged - only called when resyncing a
  // library that becomes active as a result (see resyncLibrary's own "switches to it first"
  // behavior), matching what LibrariesSettings used to do with its local resync state.
  start: (target: RescanTarget, onActiveLibraryChanged: () => void) => void;
  dismissError: () => void;
}

const RescanContext = createContext<RescanContextValue | null>(null);

// Mounted once at the app root (see main.tsx), mirroring ImportProvider/ImportContext.tsx - a
// resync started from LibrariesSettings (inside the Settings modal) previously lived entirely in
// that component's local state, so closing Settings mid-resync didn't stop the resync (the POST
// was already in flight) but did throw away the only UI showing it was still running, leaving no
// progress indicator anywhere. Living here instead means the resync - and RescanStatusBar's view of
// it - survives the Settings modal being closed.
export function RescanProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [libraryId, setLibraryId] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [progress, setProgress] = useState<RescanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  function start(target: RescanTarget, onActiveLibraryChanged: () => void) {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setIsRunning(true);
    setLibraryId(target.id);
    setLibraryName(target.name);
    setProgress(null);
    setError(null);

    const pollId = window.setInterval(() => {
      void getRescanProgress().then(setProgress, () => {});
    }, 400);

    resyncLibrary(target.id)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["libraries"] });
        if (target.isActive) {
          invalidateLibraryQueries(queryClient);
        } else {
          // Resyncing a library that wasn't active switches to it first (see the /resync endpoint).
          onActiveLibraryChanged();
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        window.clearInterval(pollId);
        runningRef.current = false;
        setIsRunning(false);
        setLibraryId(null);
        setLibraryName(null);
        setProgress(null);
      });
  }

  const value: RescanContextValue = {
    isRunning,
    libraryId,
    libraryName,
    progress,
    error,
    start,
    dismissError: () => setError(null),
  };

  return <RescanContext.Provider value={value}>{children}</RescanContext.Provider>;
}

export function useRescan(): RescanContextValue {
  const ctx = useContext(RescanContext);
  if (!ctx) {
    throw new Error("useRescan must be used within RescanProvider");
  }
  return ctx;
}
