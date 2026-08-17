import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { startSidecar, stopSidecar, waitForHealth, SidecarHandle, SidecarStatus } from "./sidecar";
import { registerNativeHandlers } from "./native";
import { buildAppMenu } from "./menu";

let sidecar: SidecarHandle | null = null;
let sidecarStatus: SidecarStatus = { state: "starting" };
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const isMac = process.platform === "darwin";
// Keyed by "<bookId>:<format>" so re-opening the same book/format focuses its existing
// window instead of stacking duplicates; different books (or the same book in a different
// format) each get their own independent window.
const readerWindows = new Map<string, BrowserWindow>();

const isDev = !app.isPackaged;

// electron-builder embeds this same icon.png into the packaged exe/app bundle;
// setting it explicitly here too keeps the dev-mode window/taskbar icon consistent.
const appIconPath = path.join(__dirname, "..", "build", "icon.png");

// Both best set as early as possible (before app is even "ready"). In a packaged build these
// mostly just formalize what electron-builder's own productName/appId already bake into the exe;
// in dev mode (running node_modules/electron's own binary directly) Windows still shows "Electron"
// as the taskbar flyout name/icon regardless — that's the raw electron.exe's own embedded resource
// strings and isn't fixable from script without rebranding the binary itself, so this is mainly for
// correctness in the packaged app and for anything (notifications, mac menu bar) that reads
// app.getName() at runtime.
app.setName("Maktaba");
app.setAppUserModelId("com.inshapardaz.maktaba");

registerNativeHandlers(() => mainWindow);

// Whether the standard File/Edit/View/Window/Help app menu (menu.ts's buildAppMenu) is shown -
// natively as each reader pop-out window's own menu bar (they use the default OS frame), and via
// a menu button in the main window's custom title bar (which has no room for a full menu bar row -
// see maktaba:show-app-menu below). A user preference, not a per-window state: persisted to disk
// so it survives restarts, independent of any one library.
const preferencesPath = path.join(app.getPath("userData"), "electron-preferences.json");

function loadMenuBarEnabled(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(preferencesPath, "utf8")) as { menuBarEnabled?: boolean };
    return raw.menuBarEnabled ?? true;
  } catch {
    return true;
  }
}

let menuBarEnabled = loadMenuBarEnabled();
const appMenu = buildAppMenu();

// Applies the current on/off state to every already-open window (main + readers) plus the mac
// global menu bar / the default new windows will otherwise inherit - called once at startup and
// again any time the setting is toggled from Settings, so an existing session never needs a
// restart to see the change take effect.
function applyMenuPreference(): void {
  Menu.setApplicationMenu(menuBarEnabled ? appMenu : null);
  for (const win of BrowserWindow.getAllWindows()) {
    win.setMenu(menuBarEnabled ? appMenu : null);
  }
}

applyMenuPreference();

ipcMain.handle("maktaba:get-menu-bar-enabled", () => menuBarEnabled);

ipcMain.handle("maktaba:set-menu-bar-enabled", (_event, enabled: boolean) => {
  menuBarEnabled = enabled;
  applyMenuPreference();
  try {
    fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
    fs.writeFileSync(preferencesPath, JSON.stringify({ menuBarEnabled }));
  } catch {
    // Best-effort - worst case the toggle just doesn't survive a restart.
  }
});

// The main window's title-bar menu button (TitleBar.tsx) has no native menu bar row to live in
// (Window Controls Overlay reserves that whole strip for the draggable custom title bar), so it
// pops the exact same Menu used elsewhere as a context menu instead, anchored under the button.
ipcMain.handle("maktaba:show-app-menu", (event, position: { x: number; y: number }) => {
  if (!menuBarEnabled) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    appMenu.popup({ window: win, x: Math.round(position.x), y: Math.round(position.y) });
  }
});

// A tiny frameless window with no preload/IPC needs (just a static local HTML file) shown the
// instant the app launches, before the sidecar has even been spawned - covers the gap between
// process start and the main window's first paint so there's no blank/white flash. Closed once
// createWindow()'s mainWindow fires "ready-to-show" (see below); never shown again on a
// retrySidecar()-triggered window recreation, only on the very first launch.
function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 420,
    frame: false,
    resizable: false,
    movable: false,
    show: true,
    skipTaskbar: true,
    icon: appIconPath,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  void splashWindow.loadFile(path.join(__dirname, "..", "splash", "splash.html"));
}

function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

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
    // Stays hidden until the page has actually painted something (see "ready-to-show" below) -
    // otherwise the window would show its own blank/white flash the instant it's created, before
    // the splash window (which is covering that gap) gets swapped out for it.
    show: false,
    ...(isMac
      ? { trafficLightPosition: { x: 16, y: (TITLEBAR_HEIGHT - 12) / 2 } }
      : { titleBarOverlay: titleBarOverlayFor("light") }),
  });

  mainWindow.once("ready-to-show", () => {
    closeSplashWindow();
    mainWindow?.show();
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

app.whenReady().then(async () => {
  createSplashWindow();
  await createWindow();
});

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
