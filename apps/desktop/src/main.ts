import { app, BrowserWindow } from "electron";
import * as path from "node:path";
import { startSidecar, stopSidecar, SidecarHandle } from "./sidecar";
import { registerNativeHandlers } from "./native";

let sidecar: SidecarHandle | null = null;
let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

registerNativeHandlers(() => mainWindow);

async function createWindow(): Promise<void> {
  sidecar = await startSidecar({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The only channel used to hand the sidecar's port/token to the
      // renderer — read by preload.ts, never exposed via URL or globals.
      additionalArguments: [
        `--maktaba-port=${sidecar.port}`,
        `--maktaba-token=${sidecar.token}`,
      ],
    },
  });

  if (isDev) {
    await mainWindow.loadURL("http://localhost:5173");
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, "..", "..", "frontend", "dist", "index.html"),
    );
  }
}

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
