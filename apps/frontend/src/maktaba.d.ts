export {};

// Mirrors apps/desktop/src/sidecar.ts's SidecarStatus — kept as a separate declaration since the
// frontend package doesn't import from the desktop package.
export type SidecarStatus =
  | { state: "starting" }
  | { state: "ready" }
  | { state: "error"; message: string };

// Mirrors apps/desktop/src/updater.ts's UpdateStatus, same reasoning as SidecarStatus above.
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

declare global {
  interface Window {
    maktaba: {
      apiBaseUrl: string;
      token: string;
      platform: NodeJS.Platform;
      pickLibraryFolder: () => Promise<string | null>;
      pickEbookFiles: () => Promise<string[]>;
      pickEbookFolder: () => Promise<string[]>;
      resolveEbookPaths: (paths: string[]) => Promise<string[]>;
      onResolveEbookPathsProgress: (callback: (progress: { found: number; currentPath: string }) => void) => () => void;
      revealInFolder: (filePath: string) => Promise<void>;
      openPath: (filePath: string) => Promise<void>;
      trashPath: (filePath: string) => Promise<void>;
      openReaderWindow: (bookId: string, format: "Epub" | "Pdf", title?: string) => Promise<void>;
      getPathForFile: (file: File) => string;
      getSidecarStatus: () => Promise<SidecarStatus>;
      onSidecarStatus: (callback: (status: SidecarStatus) => void) => () => void;
      retrySidecar: () => Promise<void>;
      setTitleBarOverlay: (scheme: "light" | "dark") => Promise<void>;
      getMenuBarEnabled: () => Promise<boolean>;
      setMenuBarEnabled: (enabled: boolean) => Promise<void>;
      showAppMenu: (position: { x: number; y: number }) => Promise<void>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
      checkForUpdates: () => Promise<void>;
      downloadUpdate: () => Promise<void>;
      quitAndInstall: () => Promise<void>;
    };
  }
}
