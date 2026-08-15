import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { SidecarStatus } from "./sidecar";

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
});
