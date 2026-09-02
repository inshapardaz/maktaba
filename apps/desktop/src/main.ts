import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { startSidecar, stopSidecar, waitForHealth, SidecarHandle, SidecarStatus } from "./sidecar";
import { registerNativeHandlers, registerStarDictProtocol } from "./native";
import { registerHelpHandlers } from "./help";
import { buildAppMenu } from "./menu";
import { checkForUpdates, initUpdater } from "./updater";

let sidecar: SidecarHandle | null = null;
let sidecarStatus: SidecarStatus = { state: "starting" };
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
const isMac = process.platform === "darwin";
// Keyed by "<bookId>:<format>" so re-opening the same book/format focuses its existing
// window instead of stacking duplicates; different books (or the same book in a different
// format) each get their own independent window.
const readerWindows = new Map<string, BrowserWindow>();
// Only one Help window is ever needed - re-invoking maktaba:open-help-window just focuses it.
let helpWindow: BrowserWindow | null = null;

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
registerHelpHandlers();
initUpdater();

// Backs the About tab's version display (SettingsScreen.tsx's AboutSettings) - same value
// menu.ts's "About Maktaba" dialog already reads main-process-side, just also exposed to the
// renderer since app.getVersion() isn't otherwise reachable there.
ipcMain.handle("maktaba:get-app-version", () => app.getVersion());

// Also for the About tab: initUpdater() below no-ops entirely (never registers its own
// maktaba:check-for-updates/get-update-status/etc. handlers at all) when !app.isPackaged, so
// AboutSettings needs to know not to call those in dev - otherwise "Check for Updates" surfaces a
// raw "No handler registered" IPC error instead of a friendly "not available in dev" message.
ipcMain.handle("maktaba:get-is-packaged", () => app.isPackaged);

// Whether the standard File/Edit/View/Window/Help app menu (menu.ts's buildAppMenu) is shown -
// natively as each reader pop-out window's own menu bar (they use the default OS frame), and via
// a menu button in the main window's custom title bar (which has no room for a full menu bar row -
// see maktaba:show-app-menu below). A user preference, not a per-window state: persisted to disk
// so it survives restarts, independent of any one library.
const preferencesPath = path.join(app.getPath("userData"), "electron-preferences.json");

function loadMenuBarEnabled(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(preferencesPath, "utf8")) as { menuBarEnabled?: boolean };
    return raw.menuBarEnabled ?? false;
  } catch {
    return false;
  }
}

let menuBarEnabled = loadMenuBarEnabled();
const appMenu = buildAppMenu(checkForUpdates, () => void openHelpWindow());

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

// Default colors used only until the page has painted and TitleBar.tsx sends the real, theme-aware
// colors via maktaba:set-titlebar-overlay (see below) - matches the "Organic" theme's light-mode
// title bar surface/text (apps/frontend/src/theme.ts's `semantic.surface`/`semantic.text`), which
// is the app's default theme. macOS has no titleBarOverlay concept — it gets inset traffic lights
// instead.
const TITLEBAR_HEIGHT = 40;
const DEFAULT_TITLEBAR_OVERLAY = { color: "#ebddc5", symbolColor: "#201e1d", height: TITLEBAR_HEIGHT };

// The native Windows/Linux caption-button strip needs literal color strings, not CSS variables, so
// TitleBar.tsx reads the page's own currently-active theme colors (via getComputedStyle - whatever
// app theme/color scheme is active, organic or white, light or dark) and forwards them here rather
// than main.ts trying to duplicate/guess the renderer's theme logic.
ipcMain.handle("maktaba:set-titlebar-overlay", (_event, colors: { color: string; symbolColor: string }) => {
  if (!isMac && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
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
      : { titleBarOverlay: DEFAULT_TITLEBAR_OVERLAY }),
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

// Opened from the main window's title bar Help button (TitleBar.tsx) and the native app menu's
// "Maktaba Help" item (menu.ts) - a plain top-level window (native OS chrome, no custom
// titleBarStyle) showing HelpWindow.tsx, following the same singleton-window pattern as
// openReaderWindow above (re-invoking just focuses the existing window instead of duplicating it).
async function openHelpWindow(): Promise<void> {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.focus();
    return;
  }
  if (!sidecar) return;

  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: "Maktaba Help",
    icon: appIconPath,
    webPreferences: webPreferencesFor(sidecar),
  });

  helpWindow = win;
  win.on("closed", () => {
    helpWindow = null;
  });

  const query: Record<string, string> = { view: "help" };
  if (isDev) {
    await win.loadURL(`http://localhost:5173/?${new URLSearchParams(query).toString()}`);
  } else {
    await win.loadFile(path.join(__dirname, "..", "..", "frontend", "dist", "index.html"), { query });
  }
}

ipcMain.handle("maktaba:open-help-window", () => openHelpWindow());

// The Help window's "Replay Getting Started Tour" button (HelpWindow.tsx) can't reach into the
// main window's own React tree (separate renderer process) to reopen OnboardingTour.tsx directly,
// so it round-trips through here instead: bring the main window forward, then broadcast an event
// it's subscribed to (App.tsx's onReplayOnboardingTour) - same "invoke here, event there" shape as
// the sidecar/update status broadcasts above.
ipcMain.handle("maktaba:replay-onboarding-tour", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("maktaba:replay-onboarding-tour");
  }
});

app.whenReady().then(async () => {
  registerStarDictProtocol();
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
