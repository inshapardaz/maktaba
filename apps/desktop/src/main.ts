import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import { startSidecar, stopSidecar, waitForHealth, SidecarHandle, SidecarStatus } from "./sidecar";
import { registerNativeHandlers } from "./native";

let sidecar: SidecarHandle | null = null;
let sidecarStatus: SidecarStatus = { state: "starting" };
let mainWindow: BrowserWindow | null = null;
// Keyed by "<bookId>:<format>" so re-opening the same book/format focuses its existing
// window instead of stacking duplicates; different books (or the same book in a different
// format) each get their own independent window.
const readerWindows = new Map<string, BrowserWindow>();

const isDev = !app.isPackaged;

// electron-builder embeds this same icon.png into the packaged exe/app bundle;
// setting it explicitly here too keeps the dev-mode window/taskbar icon consistent.
const appIconPath = path.join(__dirname, "..", "build", "icon.png");

registerNativeHandlers(() => mainWindow);

// Every window (main + readers) shows its own loading/error state driven off this, since each
// is an independent renderer process that needs to learn the current status on mount, and then
// be told about any later transition. "starting" -> "ready" is the happy path; "error" can be
// reached either from here (health check timed out) or from the sidecar process dying/failing
// to spawn (see initSidecar below).
function broadcastSidecarStatus(status: SidecarStatus): void {
  sidecarStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("maktaba:sidecar-status", status);
  }
}

ipcMain.handle("maktaba:get-sidecar-status", () => sidecarStatus);

/**
 * Spawns the backend and starts health-checking it in the background, without blocking on
 * readiness — the caller can create+show the window immediately and let the frontend render
 * its own loading state until a "ready"/"error" status comes through.
 */
async function initSidecar(): Promise<SidecarHandle> {
  sidecarStatus = { state: "starting" };
  const handle = await startSidecar({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });

  handle.process.on("error", (err) => {
    broadcastSidecarStatus({ state: "error", message: err.message });
  });

  // A process exit before we've ever reached "ready" means startup failed outright (missing
  // exe, crash on launch, etc.) — report it immediately rather than waiting out the full
  // waitForHealth timeout below.
  handle.process.once("exit", (code, signal) => {
    if (sidecarStatus.state === "starting") {
      broadcastSidecarStatus({
        state: "error",
        message: `Maktaba.Api exited before it became ready (code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""})`,
      });
    }
  });

  waitForHealth(handle.port)
    .then(() => broadcastSidecarStatus({ state: "ready" }))
    .catch((err: Error) => broadcastSidecarStatus({ state: "error", message: err.message }));

  return handle;
}

function webPreferencesFor(handle: SidecarHandle) {
  return {
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    // The only channel used to hand the sidecar's port/token to the
    // renderer — read by preload.ts, never exposed via URL or globals.
    additionalArguments: [`--maktaba-port=${handle.port}`, `--maktaba-token=${handle.token}`],
  };
}

async function createWindow(): Promise<void> {
  sidecar = await initSidecar();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: appIconPath,
    webPreferences: webPreferencesFor(sidecar),
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173");
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "..", "frontend", "dist", "index.html"),
    );
  }
}

async function openReaderWindow(bookId: string, format: string, title?: string): Promise<void> {
  if (!sidecar) return;

  const key = `${bookId}:${format}`;
  const existing = readerWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 960,
    height: 900,
    title: title || "Maktaba",
    icon: appIconPath,
    webPreferences: webPreferencesFor(sidecar),
  });

  readerWindows.set(key, win);
  win.on("closed", () => readerWindows.delete(key));

  const query: Record<string, string> = { view: "reader", bookId, format };
  if (title) query.title = title;
  if (isDev) {
    await win.loadURL(`http://localhost:5173/?${new URLSearchParams(query).toString()}`);
  } else {
    await win.loadFile(path.join(__dirname, "..", "..", "frontend", "dist", "index.html"), { query });
  }
}

ipcMain.handle(
  "maktaba:open-reader-window",
  (_event, { bookId, format, title }: { bookId: string; format: string; title?: string }) =>
    openReaderWindow(bookId, format, title),
);

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on("before-quit", () => {
  stopSidecar(sidecar);
  sidecar = null;
});
