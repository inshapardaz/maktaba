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

  // Opens a book's reader in its own top-level window so multiple books can be read at once;
  // re-invoking for the same bookId+format focuses the existing window instead of duplicating it.
  openReaderWindow: (bookId: string, format: "Epub" | "Pdf", title?: string): Promise<void> =>
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

  // Keeps the native win/linux caption-button overlay in sync with the app's own light/dark
  // setting (TitleBar.tsx calls this from a useComputedColorScheme effect); no-op on mac.
  setTitleBarOverlay: (scheme: "light" | "dark"): Promise<void> =>
    ipcRenderer.invoke("maktaba:set-titlebar-overlay", scheme),

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

  // On mac (no signed build to silently install - see updater.ts), this opens the GitHub releases
  // page in the default browser instead of actually downloading anything in-app.
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke("maktaba:download-update"),

  quitAndInstall: (): Promise<void> => ipcRenderer.invoke("maktaba:quit-and-install"),
});
