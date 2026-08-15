import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import { startSidecar, stopSidecar, waitForHealth, SidecarHandle, SidecarStatus } from "./sidecar";
import { registerNativeHandlers } from "./native";

let sidecar: SidecarHandle | null = null;
let sidecarStatus: SidecarStatus = { state: "starting" };
let mainWindow: BrowserWindow | null = null;
const isMac = process.platform === "darwin";
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

// Approximates Mantine's own default light/dark body colors (theme.ts is intentionally left thin,
// so these are the library defaults, not a hand-picked palette) so the native Windows/Linux
// caption-button strip doesn't flash a mismatched color against the custom title bar rendered in
// the page (TitleBar.tsx calls maktaba:set-titlebar-overlay whenever the app's computed color
// scheme changes). macOS has no titleBarOverlay concept — it gets inset traffic lights instead.
const TITLEBAR_HEIGHT = 40;

function titleBarOverlayFor(scheme: "light" | "dark") {
  return scheme === "dark"
    ? { color: "#1a1b1e", symbolColor: "#c1c2c5", height: TITLEBAR_HEIGHT }
    : { color: "#ffffff", symbolColor: "#000000", height: TITLEBAR_HEIGHT };
}

ipcMain.handle("maktaba:set-titlebar-overlay", (_event, scheme: "light" | "dark") => {
  if (!isMac && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitleBarOverlay(titleBarOverlayFor(scheme));
  }
});

async function createWindow(): Promise<void> {
  sidecar = await initSidecar();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: appIconPath,
    webPreferences: webPreferencesFor(sidecar),
    // Hides the native title bar so the renderer can draw its own (TitleBar.tsx) while keeping
    // the native minimize/maximize/close affordances — a plain `frame: false` would lose those.
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: (TITLEBAR_HEIGHT - 12) / 2 } }
      : { titleBarOverlay: titleBarOverlayFor("light") }),
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173");
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "..", "frontend", "dist", "index.html"),
    );
  }
}

/**
 * Retries after a sidecarStatus "error" (see BackendGate.tsx's Retry button). Two cases:
 *  - The sidecar process is still alive and it was just waitForHealth timing out (slow startup) -
 *    re-run the health check against that same process/port.
 *  - The process actually died - a fresh one needs a new random port/token, but every existing
 *    window's apiBaseUrl/token were baked in once via preload's additionalArguments at window
 *    creation time and can't be updated in place, so the only reliable fix is recreating the main
 *    window entirely (a plain reload() would keep pointing at the old, now-wrong port).
 */
async function retrySidecar(): Promise<void> {
  if (sidecar && sidecar.process.exitCode === null && !sidecar.process.killed) {
    broadcastSidecarStatus({ state: "starting" });
    try {
      await waitForHealth(sidecar.port);
      broadcastSidecarStatus({ state: "ready" });
    } catch (err) {
      broadcastSidecarStatus({ state: "error", message: (err as Error).message });
    }
    return;
  }

  stopSidecar(sidecar);
  sidecar = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  await createWindow();
}

ipcMain.handle("maktaba:retry-sidecar", () => retrySidecar());

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
