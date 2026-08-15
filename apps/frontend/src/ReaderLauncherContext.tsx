import { createContext, useContext, type ReactNode } from "react";

export interface ReaderRequest {
  bookId: string;
  format: "Epub" | "Pdf";
  title?: string;
  // Needed for the "external app" reader-engine setting (see readerSettings.ts) to hand the file
  // straight to window.maktaba.openPath instead of ever touching the in-app reader.
  absolutePath: string;
}

type ReaderLauncher = (request: ReaderRequest) => void;

const ReaderLauncherContext = createContext<ReaderLauncher | null>(null);

// Mounted once in App.tsx, which owns the actual decision (internal vs external app, pop-out
// window vs inline in the main window) - every "Read"/"Resume" action elsewhere (BookDetailPanel,
// HomeView, ...) just calls this instead of hand-rolling window.maktaba.openReaderWindow itself.
export function ReaderLauncherProvider({ launch, children }: { launch: ReaderLauncher; children: ReactNode }) {
  return <ReaderLauncherContext.Provider value={launch}>{children}</ReaderLauncherContext.Provider>;
}

export function useReaderLauncher(): ReaderLauncher {
  const ctx = useContext(ReaderLauncherContext);
  if (!ctx) {
    throw new Error("useReaderLauncher must be used within ReaderLauncherProvider");
  }
  return ctx;
}
