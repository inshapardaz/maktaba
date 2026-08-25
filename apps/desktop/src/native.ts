import { app, ipcMain, dialog, shell, BrowserWindow } from "electron";
import { promises as fs } from "fs";
import path from "path";

const EBOOK_EXTENSIONS = new Set([".epub", ".pdf"]);

// Issue #30: Hunspell dictionary files (.aff/.dic) the user provides for offline spell-check in
// the reader - an app-wide asset (not tied to any one library), so it lives alongside
// electron-preferences.json in Electron's userData folder rather than inside a library folder or
// going through the Maktaba.Api sidecar at all.
function dictionariesDir(): string {
  return path.join(app.getPath("userData"), "Dictionaries");
}

// Language codes only ever come from this app's own curated language list (dictionaryLanguages.ts
// on the renderer side), but they end up directly in a filesystem path below - guarded here anyway
// so a coding mistake upstream can never turn into a path-traversal write/read.
const LANGUAGE_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]{0,15}$/;

function sanitizedLanguageOrThrow(language: string): string {
  if (!LANGUAGE_CODE_PATTERN.test(language)) {
    throw new Error(`Invalid language code: ${language}`);
  }
  return language;
}

function isEbookFile(filePath: string): boolean {
  return EBOOK_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

interface ScanProgress {
  found: number;
  currentPath: string;
}

// Recursively walks a directory (no depth limit) collecting .epub/.pdf files, so "Import folder"
// / dropping a folder can pick up books organized in nested Author/Title subfolders (e.g. an
// existing Calibre export or another Maktaba library's on-disk layout). Reports progress as it
// goes (folder tree walks over a large library can take a few seconds) via onProgress rather than
// only returning a final result, so the renderer can show a live "scanning…" indicator. Checks
// `cancelled` between directories so a closed (not minimized) ImportDialog can actually stop the
// walk rather than just having the renderer ignore its eventual result.
async function walkEbookFiles(
  dirPath: string,
  foundRef: { count: number },
  onProgress: (progress: ScanProgress) => void,
  cancelled: { current: boolean },
): Promise<string[]> {
  if (cancelled.current) return [];
  onProgress({ found: foundRef.count, currentPath: dirPath });
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (cancelled.current) break;
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkEbookFiles(entryPath, foundRef, onProgress, cancelled)));
    } else if (entry.isFile() && isEbookFile(entryPath)) {
      results.push(entryPath);
      foundRef.count++;
      onProgress({ found: foundRef.count, currentPath: dirPath });
    }
  }
  return results;
}

/**
 * Native OS integrations the renderer can't do itself (dialogs, opening/revealing files).
 * Exposed to the renderer via ipcRenderer.invoke + preload's contextBridge.
 */
export function registerNativeHandlers(getWindow: () => BrowserWindow | null): void {
  // Only one folder scan runs at a time (the import dialog is a singleton per window), so a single
  // shared flag is enough - reset at the start of each new scan, flipped by the cancel handler
  // below (fired when the ImportDialog is closed outright rather than minimized).
  const scanCancelled = { current: false };

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

  ipcMain.handle("maktaba:pick-ebook-folder", async () => {
    const win = getWindow();
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      title: "Import ebooks from folder",
      properties: ["openDirectory", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  // Flattens a mix of file/folder paths (from the folder picker or a drag-and-drop event) into a
  // deduped list of .epub/.pdf file paths, recursing into any folders. Used for both "Import
  // folder" and dropping a folder onto the import dropzone. Emits "maktaba:resolve-ebook-paths-
  // progress" events on the same WebContents as it walks so the renderer can show live scan
  // progress instead of a single opaque wait.
  ipcMain.handle("maktaba:resolve-ebook-paths", async (event, paths: string[]) => {
    scanCancelled.current = false;
    const results = new Set<string>();
    const foundRef = { count: 0 };
    const onProgress = (progress: ScanProgress) => {
      event.sender.send("maktaba:resolve-ebook-paths-progress", progress);
    };
    for (const inputPath of paths) {
      if (scanCancelled.current) break;
      let stat;
      try {
        stat = await fs.stat(inputPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        for (const filePath of await walkEbookFiles(inputPath, foundRef, onProgress, scanCancelled)) {
          results.add(filePath);
        }
      } else if (isEbookFile(inputPath)) {
        results.add(inputPath);
        foundRef.count++;
        onProgress({ found: foundRef.count, currentPath: inputPath });
      }
    }
    return scanCancelled.current ? [] : [...results];
  });

  // Fired when the ImportDialog is closed outright (not minimized) while a folder scan is still
  // running - see ImportContext.tsx's cancel(). The in-flight resolve-ebook-paths call above
  // notices this on its next directory/path and unwinds early instead of continuing to walk a
  // folder tree nobody's waiting on anymore.
  ipcMain.handle("maktaba:cancel-resolve-ebook-paths", () => {
    scanCancelled.current = true;
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

  ipcMain.handle("maktaba:pick-dictionary-file", async (_event, extension: "aff" | "dic") => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: extension === "aff" ? "Choose a Hunspell .aff file" : "Choose a Hunspell .dic file",
      properties: ["openFile"],
      filters: [{ name: "Hunspell Dictionary", extensions: [extension] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Only languages with *both* files present are reported - a lone .aff or .dic left over from a
  // failed/partial save (see saveDictionary below) isn't usable by qari's Reader.
  ipcMain.handle("maktaba:list-dictionaries", async () => {
    let entries: string[];
    try {
      entries = await fs.readdir(dictionariesDir());
    } catch {
      return [];
    }

    const affLanguages = new Set<string>();
    const dicLanguages = new Set<string>();
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (ext === ".aff") affLanguages.add(path.basename(entry, ext));
      if (ext === ".dic") dicLanguages.add(path.basename(entry, ext));
    }

    return [...affLanguages].filter((language) => dicLanguages.has(language)).sort();
  });

  ipcMain.handle(
    "maktaba:save-dictionary",
    async (_event, language: string, affSourcePath: string, dicSourcePath: string) => {
      const lang = sanitizedLanguageOrThrow(language);
      const dir = dictionariesDir();
      await fs.mkdir(dir, { recursive: true });
      // Copied to temp-ish names first and renamed into place, so a failure partway (e.g. disk
      // full on the second copy) can't leave one file updated and the other stale/mismatched.
      const affTemp = path.join(dir, `${lang}.aff.tmp`);
      const dicTemp = path.join(dir, `${lang}.dic.tmp`);
      await fs.copyFile(affSourcePath, affTemp);
      await fs.copyFile(dicSourcePath, dicTemp);
      await fs.rename(affTemp, path.join(dir, `${lang}.aff`));
      await fs.rename(dicTemp, path.join(dir, `${lang}.dic`));
    },
  );

  ipcMain.handle("maktaba:remove-dictionary", async (_event, language: string) => {
    const lang = sanitizedLanguageOrThrow(language);
    const dir = dictionariesDir();
    await fs.rm(path.join(dir, `${lang}.aff`), { force: true });
    await fs.rm(path.join(dir, `${lang}.dic`), { force: true });
  });

  // Returns file contents directly (Node Buffers, which structured-clone as Uint8Array over IPC)
  // rather than paths - the renderer has no filesystem access of its own to read them with, same
  // reasoning as readHelpAsset in help.ts.
  ipcMain.handle("maktaba:read-dictionary", async (_event, language: string) => {
    const lang = sanitizedLanguageOrThrow(language);
    const dir = dictionariesDir();
    try {
      const [aff, dic] = await Promise.all([
        fs.readFile(path.join(dir, `${lang}.aff`)),
        fs.readFile(path.join(dir, `${lang}.dic`)),
      ]);
      return { aff, dic };
    } catch {
      return null;
    }
  });
}
