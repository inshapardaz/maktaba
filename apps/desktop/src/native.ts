import { ipcMain, dialog, shell, BrowserWindow } from "electron";

/**
 * Native OS integrations the renderer can't do itself (dialogs, opening/revealing files).
 * Exposed to the renderer via ipcRenderer.invoke + preload's contextBridge.
 */
export function registerNativeHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("maktaba:pick-library-folder", async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Choose or create a library folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("maktaba:pick-ebook-files", async () => {
    const win = getWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      title: "Import ebooks",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Ebooks", extensions: ["epub", "pdf"] }],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("maktaba:reveal-in-folder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("maktaba:open-path", async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    if (error) {
      throw new Error(error);
    }
  });

  ipcMain.handle("maktaba:trash-path", async (_event, filePath: string) => {
    await shell.trashItem(filePath);
  });
}
