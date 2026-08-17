import { createContext, useContext, type ReactNode } from "react";
import type { ReadingStatus } from "./api";

export interface ReaderRequest {
  bookId: string;
  format: "Epub" | "Pdf";
  title?: string;
  // Needed for the "external app" reader-engine setting (see readerSettings.ts) to hand the file
  // straight to window.maktaba.openPath instead of ever touching the in-app reader.
  absolutePath: string;
  // The book's status *before* this read - lets App.tsx's launchReader auto-bump Unread -> Reading
  // without an extra fetch, since every caller already has this in hand from whatever query got it
  // the book in the first place (BookSummary/BookDetail/ContinueReadingBook all carry it).
  readingStatus: ReadingStatus;
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
