import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { SidecarStatus } from "./sidecar";
import type { UpdateStatus } from "./updater";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const port = getArg("maktaba-port");
const token = getArg("maktaba-token");

if (!port || !token) {
  throw new Error(
    "Maktaba preload: missing --maktaba-port/--maktaba-token additionalArguments from main process",
  );
}

contextBridge.exposeInMainWorld("maktaba", {
  apiBaseUrl: `http://127.0.0.1:${port}`,
  token,
  // Lets renderer-side layout (TitleBar.tsx) reserve space for the native traffic lights (mac)
  // vs. the native caption-button overlay (win/linux) without guessing the OS from the UA string.
  platform: process.platform,

  pickLibraryFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("maktaba:pick-library-folder"),

  pickEbookFiles: (): Promise<string[]> => ipcRenderer.invoke("maktaba:pick-ebook-files"),

  pickEbookFolder: (): Promise<string[]> => ipcRenderer.invoke("maktaba:pick-ebook-folder"),

  // Recursively flattens folders (and passes through already-matching files) into a deduped list
  // of importable .epub/.pdf paths - shared by the folder picker and folder drag-and-drop.
  resolveEbookPaths: (paths: string[]): Promise<string[]> =>
    ipcRenderer.invoke("maktaba:resolve-ebook-paths", paths),

  // Stops an in-flight resolveEbookPaths walk early - see native.ts's scanCancelled.
  cancelResolveEbookPaths: (): Promise<void> => ipcRenderer.invoke("maktaba:cancel-resolve-ebook-paths"),

  // Live progress while resolveEbookPaths walks a folder tree - see native.ts's walkEbookFiles.
  onResolveEbookPathsProgress: (callback: (progress: { found: number; currentPath: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { found: number; currentPath: string }) =>
      callback(progress);
    ipcRenderer.on("maktaba:resolve-ebook-paths-progress", listener);
    return () => ipcRenderer.removeListener("maktaba:resolve-ebook-paths-progress", listener);
  },

  revealInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("maktaba:reveal-in-folder", filePath),

  openPath: (filePath: string): Promise<void> => ipcRenderer.invoke("maktaba:open-path", filePath),

  trashPath: (filePath: string): Promise<void> => ipcRenderer.invoke("maktaba:trash-path", filePath),

  // Best-effort cleanup for a book's now-possibly-empty author folder after trashPath removed the
  // book's own folder - see BookRemovalResult.ParentFolderPath's doc comment for exactly when the
  // backend hands one back. A no-op if the folder is missing or still has something in it.
  trashPathIfEmpty: (folderPath: string): Promise<void> => ipcRenderer.invoke("maktaba:trash-path-if-empty", folderPath),

  // Opens a book's reader in its own top-level window so multiple books can be read at once;
  // re-invoking for the same bookId+format focuses the existing window instead of duplicating it.
  openReaderWindow: (bookId: string, format: "Epub" | "Pdf" | "Docx" | "Txt", title?: string): Promise<void> =>
    ipcRenderer.invoke("maktaba:open-reader-window", { bookId, format, title }),

  // Resolves the real filesystem path for a File dropped onto the window (drag-and-drop import).
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // The Maktaba.Api sidecar starts asynchronously alongside this window (see main.ts's
  // initSidecar) — getSidecarStatus() gives the renderer its current state on mount, and
  // onSidecarStatus() delivers later transitions ("starting" -> "ready" or "error") so the
  // frontend can show a loading screen / error message instead of hitting a dead API.
  getSidecarStatus: (): Promise<SidecarStatus> => ipcRenderer.invoke("maktaba:get-sidecar-status"),

  onSidecarStatus: (callback: (status: SidecarStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SidecarStatus) => callback(status);
    ipcRenderer.on("maktaba:sidecar-status", listener);
    return () => ipcRenderer.removeListener("maktaba:sidecar-status", listener);
  },

  // Called from BackendGate.tsx's Retry button after a sidecarStatus "error" - re-checks the
  // existing sidecar's health, or respawns it (and this window) entirely if it actually died.
  retrySidecar: (): Promise<void> => ipcRenderer.invoke("maktaba:retry-sidecar"),

  // Back TitleBar.tsx's own custom minimize/maximize/close buttons (WindowControls) on win/linux,
  // where the window is fully frameless - see main.ts's createWindow. Not called on mac, which
  // keeps native traffic lights instead.
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("maktaba:window-minimize"),
  toggleMaximizeWindow: (): Promise<void> => ipcRenderer.invoke("maktaba:window-toggle-maximize"),
  closeWindow: (): Promise<void> => ipcRenderer.invoke("maktaba:window-close"),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke("maktaba:window-is-maximized"),
  onWindowMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on("maktaba:window-maximized-changed", listener);
    return () => ipcRenderer.removeListener("maktaba:window-maximized-changed", listener);
  },

  // Whether the standard File/Edit/View/Window/Help app menu (see main.ts/menu.ts) is on - a
  // persisted preference, not per-window state, toggled from Settings and reflected live in every
  // open window (reader pop-outs' own native menu bar, and the main window's menu button).
  getMenuBarEnabled: (): Promise<boolean> => ipcRenderer.invoke("maktaba:get-menu-bar-enabled"),

  setMenuBarEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("maktaba:set-menu-bar-enabled", enabled),

  // Pops the same app menu as a context menu at the given point in the caller's own window -
  // used by the main window's title-bar menu button, which has no native menu bar row to live in
  // (Window Controls Overlay reserves that whole strip for the custom draggable title bar).
  showAppMenu: (position: { x: number; y: number }): Promise<void> =>
    ipcRenderer.invoke("maktaba:show-app-menu", position),

  // Issue #5: update notification, driven by updater.ts's autoUpdater wiring (main-process-only -
  // electron-updater talks to the OS filesystem/installer directly, nothing here does that work).
  // getUpdateStatus() gives the renderer its current state on mount, onUpdateStatus() delivers
  // later transitions, same "get current + subscribe to later" pairing as getSidecarStatus/
  // onSidecarStatus above.
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("maktaba:get-update-status"),

  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on("maktaba:update-status", listener);
    return () => ipcRenderer.removeListener("maktaba:update-status", listener);
  },

  checkForUpdates: (): Promise<void> => ipcRenderer.invoke("maktaba:check-for-updates"),

  // Backs the About tab's version display - see main.ts's maktaba:get-app-version handler.
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("maktaba:get-app-version"),

  // Lets the About tab avoid calling the update-check IPC methods at all in dev, where none of
  // them are registered (see main.ts's maktaba:get-is-packaged handler / updater.ts's initUpdater).
  isPackaged: (): Promise<boolean> => ipcRenderer.invoke("maktaba:get-is-packaged"),

  // On mac (no signed build to silently install - see updater.ts), this opens the GitHub releases
  // page in the default browser instead of actually downloading anything in-app.
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke("maktaba:download-update"),

  quitAndInstall: (): Promise<void> => ipcRenderer.invoke("maktaba:quit-and-install"),

  // Offline help content (see help.ts) for the standalone Help window (HelpWindow.tsx, opened via
  // openHelpWindow) and the onboarding tour's screenshot placeholders - reads packaged/dev-mode
  // docs/ markdown via IPC rather than fetch(), same convention as every other filesystem access.
  listHelpTopics: (locale: "en" | "ur"): Promise<{ slug: string; title: string }[]> =>
    ipcRenderer.invoke("maktaba:list-help-topics", locale),

  readHelpTopic: (locale: "en" | "ur", slug: string): Promise<{ title: string; bodyMarkdown: string } | null> =>
    ipcRenderer.invoke("maktaba:read-help-topic", locale, slug),

  // relativePath is the raw src of a markdown image reference (e.g. "../screenshots/x.svg") -
  // resolved server-side (help.ts) and returned as a base64 data URL, since the renderer has no
  // direct filesystem access to either the packaged resources or the dev-mode docs/ source.
  readHelpAsset: (relativePath: string): Promise<string | null> =>
    ipcRenderer.invoke("maktaba:read-help-asset", relativePath),

  // Opens (or focuses, if already open) the dedicated Help window - see main.ts's openHelpWindow.
  // Called from the main window's title bar Help button (TitleBar.tsx).
  openHelpWindow: (): Promise<void> => ipcRenderer.invoke("maktaba:open-help-window"),

  // Round-trips through the main process so the Help window (a separate renderer) can reopen
  // OnboardingTour.tsx, which lives in the main window's own React tree - see main.ts's
  // maktaba:replay-onboarding-tour handler.
  replayOnboardingTour: (): Promise<void> => ipcRenderer.invoke("maktaba:replay-onboarding-tour"),

  onReplayOnboardingTour: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("maktaba:replay-onboarding-tour", listener);
    return () => ipcRenderer.removeListener("maktaba:replay-onboarding-tour", listener);
  },

  // qari issue #17: offline StarDict/GoldenDict word-lookup dictionaries (.ifo/.idx/.dict[.dz]) -
  // stored app-wide in Electron's userData folder (see native.ts's starDictDictionariesDir), not
  // library data, so this never goes through the Maktaba.Api sidecar. The user picks a single zip
  // containing the dictionary's three files (see ReaderOverlay.tsx's stardictDictionaries prop for
  // how the reader consumes the result).
  pickStarDictZipFile: (): Promise<string | null> => ipcRenderer.invoke("maktaba:pick-stardict-zip"),

  listStarDictDictionaries: (): Promise<string[]> => ipcRenderer.invoke("maktaba:list-stardict-dictionaries"),

  saveStarDictDictionary: (language: string, zipSourcePath: string): Promise<void> =>
    ipcRenderer.invoke("maktaba:save-stardict-dictionary", language, zipSourcePath),

  removeStarDictDictionary: (language: string): Promise<void> =>
    ipcRenderer.invoke("maktaba:remove-stardict-dictionary", language),

  // Returns stardict:// URLs rather than file contents - the dictionary's own bytes (its .dict file
  // especially can be tens of MB) are fetched by the reader directly via net.fetch's stardict://
  // handler (see native.ts's registerStarDictProtocol) rather than crossing the IPC boundary.
  getStarDictDictionaryUrls: (language: string): Promise<{ ifoUrl: string; idxUrl: string; dictUrl: string } | null> =>
    ipcRenderer.invoke("maktaba:get-stardict-dictionary-urls", language),

  // Cloud storage provider secrets (S3 access key/secret, OAuth refresh tokens), encrypted at rest
  // via Electron's safeStorage - see native.ts's cloudCredentialsDir. ref is an opaque id the
  // caller generates and persists as the library registry entry's CredentialRef; the secret itself
  // never round-trips through config.json or the backend, only this ref does.
  saveCloudCredential: (ref: string, secret: string): Promise<void> =>
    ipcRenderer.invoke("maktaba:save-cloud-credential", ref, secret),

  getCloudCredential: (ref: string): Promise<string | null> =>
    ipcRenderer.invoke("maktaba:get-cloud-credential", ref),

  deleteCloudCredential: (ref: string): Promise<void> =>
    ipcRenderer.invoke("maktaba:delete-cloud-credential", ref),

  // Cloud: Phase 4 (#96) - runs the interactive OneDrive sign-in (opens the system browser,
  // resolves once it redirects back to a temporary loopback listener). Rejects if the user closes
  // the browser without completing sign-in, denies consent, is cancelled (see below), or it times
  // out.
  connectOneDrive: (): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> =>
    ipcRenderer.invoke("maktaba:connect-onedrive"),

  // Stops a still-pending connectOneDrive() call immediately - see native.ts's
  // oneDriveConnectAbort. The pending connectOneDrive() promise rejects as a result of this;
  // callers don't need to do anything else to "cancel" their own await.
  cancelOneDriveConnect: (): Promise<void> =>
    ipcRenderer.invoke("maktaba:cancel-onedrive-connect"),

  // Cloud: Phase 5 (#99) - runs the interactive Google Drive sign-in (opens the system browser,
  // resolves once it redirects back to a temporary loopback listener). Rejects if the user closes
  // the browser without completing sign-in, denies consent, is cancelled (see below), or it times
  // out.
  connectGoogleDrive: (): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> =>
    ipcRenderer.invoke("maktaba:connect-google-drive"),

  // Stops a still-pending connectGoogleDrive() call immediately - see native.ts's
  // googleDriveConnectAbort. The pending connectGoogleDrive() promise rejects as a result of this;
  // callers don't need to do anything else to "cancel" their own await.
  cancelGoogleDriveConnect: (): Promise<void> =>
    ipcRenderer.invoke("maktaba:cancel-google-drive-connect"),
});
