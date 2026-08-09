export {};

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
      getPathForFile: (file: File) => string;
    };
  }
}
