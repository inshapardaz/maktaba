export {};

// Mirrors apps/desktop/src/sidecar.ts's SidecarStatus — kept as a separate declaration since the
// frontend package doesn't import from the desktop package.
export type SidecarStatus =
  | { state: "starting" }
  | { state: "ready" }
  | { state: "error"; message: string };

declare global {
  interface Window {
    maktaba: {
      apiBaseUrl: string;
      token: string;
      pickLibraryFolder: () => Promise<string | null>;
      pickEbookFiles: () => Promise<string[]>;
      revealInFolder: (filePath: string) => Promise<void>;
      openPath: (filePath: string) => Promise<void>;
      trashPath: (filePath: string) => Promise<void>;
      openReaderWindow: (bookId: string, format: "Epub" | "Pdf", title?: string) => Promise<void>;
      getPathForFile: (file: File) => string;
      getSidecarStatus: () => Promise<SidecarStatus>;
      onSidecarStatus: (callback: (status: SidecarStatus) => void) => () => void;
    };
  }
}
