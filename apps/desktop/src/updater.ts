import { app, BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";

const RELEASES_URL = "https://github.com/inshapardaz/maktab/releases/latest";

// macOS auto-update (electron-updater silently downloading + relaunching into a new app bundle)
// needs a signed, notarized app - ours currently isn't (see README's "Known issues" and
// apps/desktop/package.json's mac signing config, which only activates once Apple Developer
// secrets are added to the repo). Attempting a silent download/install against an unsigned build
// risks a confusing failure rather than a clean one, so mac gets the lighter "tell the user, open
// the releases page" path instead; win/linux get the full silent download + install-on-restart flow.
const supportsAutoInstall = process.platform !== "darwin";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

let status: UpdateStatus = { state: "idle" };
let initialized = false;

function broadcast(next: UpdateStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("maktaba:update-status", next);
  }
}

// Shared by the IPC handler below (renderer's "Check for updates" button, if ever added) and
// menu.ts's "Check for Updates…" item (a main-process click handler, which can't go through
// ipcRenderer.invoke since it isn't itself a renderer). A no-op before initUpdater has run
// (dev mode) or if a check is already in flight.
export function checkForUpdates(): void {
  if (!initialized) return;
  void autoUpdater.checkForUpdates().catch((err: Error) => broadcast({ state: "error", message: err.message }));
}

// Called once at startup (see main.ts). No-ops entirely in dev (`electron .` isn't running from a
// real installed location electron-updater can compare/replace) - packaged builds only.
export function initUpdater(): void {
  if (!app.isPackaged) {
    return;
  }
  initialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));

  // On mac (no in-app download path - see supportsAutoInstall above), "available" just means "go
  // get it yourself" - UpdateNotifier.tsx renders a straight link there instead of a Download button.
  autoUpdater.on("update-available", (info) => broadcast({ state: "available", version: info.version }));

  autoUpdater.on("update-not-available", () => broadcast({ state: "not-available" }));

  autoUpdater.on("download-progress", (progress) => {
    broadcast({ state: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => broadcast({ state: "downloaded", version: info.version }));

  autoUpdater.on("error", (err) => broadcast({ state: "error", message: err.message }));

  ipcMain.handle("maktaba:get-update-status", () => status);

  ipcMain.handle("maktaba:check-for-updates", () => checkForUpdates());

  ipcMain.handle("maktaba:download-update", () => {
    if (!supportsAutoInstall) {
      void shell.openExternal(RELEASES_URL);
      return;
    }
    void autoUpdater.downloadUpdate().catch((err: Error) => broadcast({ state: "error", message: err.message }));
  });

  ipcMain.handle("maktaba:quit-and-install", () => {
    autoUpdater.quitAndInstall();
  });

  // One check shortly after launch (not immediately - let the window finish showing first) rather
  // than a recurring interval timer - this app has no background/tray presence to keep alive for
  // periodic checks between launches, so "once per app start" is the only check that's ever going
  // to run anyway. The menu's "Check for Updates…" covers the on-demand case.
  setTimeout(checkForUpdates, 10_000);
}
