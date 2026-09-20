import { app, ipcMain, dialog, shell, protocol, net, safeStorage, BrowserWindow } from "electron";
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { gunzipSync } from "zlib";
import JSZip from "jszip";
import { connectOneDrive } from "./oneDriveAuth";
import { connectGoogleDrive, revokeGoogleDriveToken } from "./googleDriveAuth";

const EBOOK_EXTENSIONS = new Set([".epub", ".pdf", ".docx", ".txt"]);

// qari issue #17: offline word-lookup dictionaries in the StarDict format (.ifo/.idx/.dict[.dz]) -
// the format used by both the StarDict and GoldenDict desktop applications, and the one most
// GoldenDict-distributed dictionaries ship in. An app-wide asset (not tied to any one library), so
// it lives alongside electron-preferences.json in Electron's userData folder rather than inside a
// library folder or going through the Maktaba.Api sidecar at all - one subfolder per language.
function starDictDictionariesDir(): string {
  return path.join(app.getPath("userData"), "StarDictDictionaries");
}

// A dictionary's .dict/.dict.dz file can be tens of MB or more - too large to comfortably shuttle
// through ipcRenderer.invoke's structured-clone (unlike the book/cover bytes elsewhere in this app,
// which always go over the local HTTP sidecar instead of IPC for exactly this reason). qari's
// stardictDictionaries prop supports a URL-based mode instead of buffers specifically for this, so
// a "stardict:" scheme is registered to serve these files directly off disk - the renderer fetches
// them itself (see net.fetch below) rather than the file's bytes ever crossing the IPC boundary.
// registerSchemesAsPrivileged must run before app is ready, so this executes at import time (main.ts
// imports this module before its own app.whenReady()); the actual protocol.handle call needs the
// app to already be ready, so that part is registerStarDictProtocol, called from main.ts after that.
protocol.registerSchemesAsPrivileged([
  { scheme: "stardict", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// stardict://<language>/<filename> -> {starDictDictionariesDir()}/<language>/<filename>. Both
// segments are validated before touching the filesystem - <filename> in particular can't be
// steered by a compromised renderer under normal use (it only ever comes from this file's own
// get-stardict-dictionary-urls handler), but a URL is still attacker-shaped input on principle.
export function registerStarDictProtocol(): void {
  protocol.handle("stardict", (request) => {
    const url = new URL(request.url);
    const lang = url.hostname;
    const filename = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!LANGUAGE_CODE_PATTERN.test(lang) || !filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return new Response("Invalid StarDict dictionary request", { status: 400 });
    }
    const filePath = path.join(starDictDictionariesDir(), lang, filename);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// Language codes only ever come from this app's own curated language list (dictionaryLanguages.ts
// on the renderer side), but they end up directly in a filesystem path below - guarded here anyway
// so a coding mistake upstream can never turn into a path-traversal write/read.
const LANGUAGE_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]{0,15}$/;

// Cloud Sync Core: cloud storage provider secrets (S3 access key/secret, OAuth refresh tokens) -
// an app-wide store, same reasoning as StarDict dictionaries above (not library data, never goes
// through the Maktaba.Api sidecar), but encrypted at rest via Electron's safeStorage (OS keychain
// on mac, DPAPI on Windows, libsecret on Linux) since these are actual secrets, unlike a
// dictionary file. Only an opaque "credential ref" (see Maktaba.Core's LibraryRegistryEntry.
// CredentialRef) ever reaches config.json/the backend - the secret itself lives only in one of
// these encrypted files, keyed by that ref.
function cloudCredentialsDir(): string {
  return path.join(app.getPath("userData"), "CloudCredentials");
}

// A credential ref is caller-generated (the renderer, when connecting a new cloud library) and
// used directly as a filename below - validated on principle before touching the filesystem, same
// guard as sanitizedLanguageOrThrow just below for StarDict language names.
function sanitizedCredentialRefOrThrow(ref: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) {
    throw new Error(`Invalid credential reference: ${ref}`);
  }
  return ref;
}

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
      filters: [{ name: "Ebooks", extensions: ["epub", "pdf", "docx", "txt"] }],
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

  // Issue: deleting the last book by an author left its now-empty author folder behind on disk
  // forever (see BookRemovalResult.ParentFolderPath's own comment for why only a plain book's
  // parent - never a periodical issue's - is ever passed here). Only trashes the folder if it's
  // genuinely empty *right now* - checked here, right after the caller's own maktaba:trash-path
  // call for the book folder itself actually completed, rather than the backend guessing ahead of
  // time whether it will end up empty. Silently does nothing if the folder is missing (ENOENT - the
  // trash operation for the book folder above may have already taken it, or it never existed) or
  // still has something in it (a file the user placed there Maktaba doesn't know about, for
  // instance) - this is pure best-effort tidiness, never something a caller should treat as
  // required to succeed.
  ipcMain.handle("maktaba:trash-path-if-empty", async (_event, folderPath: string) => {
    let entries: string[];
    try {
      entries = await fs.readdir(folderPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    if (entries.length === 0) {
      await shell.trashItem(folderPath);
    }
  });

  ipcMain.handle("maktaba:pick-stardict-zip", async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: "Choose a StarDict/GoldenDict dictionary .zip file",
      properties: ["openFile"],
      filters: [{ name: "StarDict Dictionary (zip)", extensions: ["zip"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Only languages whose folder still has a complete .ifo/.idx/.dict(.dz) trio are reported - a
  // partial save (see save-stardict-dictionary below) never leaves a folder qari's Reader could
  // pick up half-configured.
  ipcMain.handle("maktaba:list-stardict-dictionaries", async () => {
    let entries: string[];
    try {
      const dirents = await fs.readdir(starDictDictionariesDir(), { withFileTypes: true });
      entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }

    const languages: string[] = [];
    for (const lang of entries) {
      const dir = path.join(starDictDictionariesDir(), lang);
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      const hasIfo = files.some((f) => f.toLowerCase().endsWith(".ifo"));
      const hasIdx = files.some((f) => f.toLowerCase().endsWith(".idx"));
      const hasDict = files.some((f) => /\.dict(\.dz)?$/i.test(f));
      if (hasIfo && hasIdx && hasDict) languages.push(lang);
    }
    return languages.sort();
  });

  // A StarDict dictionary is a trio of files (.ifo/.idx/.dict[.dz]) - most GoldenDict-distributed
  // dictionaries are shared as a single zip containing that trio (sometimes inside a subfolder), so
  // rather than asking the user to pick three separate files, they choose that one zip and it's
  // unpacked here into this dictionary's own folder under starDictDictionariesDir.
  ipcMain.handle("maktaba:save-stardict-dictionary", async (_event, language: string, zipSourcePath: string) => {
    const lang = sanitizedLanguageOrThrow(language);
    if (path.extname(zipSourcePath).toLowerCase() !== ".zip") {
      throw new Error("Please choose the dictionary's .zip file.");
    }

    const zip = await JSZip.loadAsync(await fs.readFile(zipSourcePath));
    const ifoEntry = zip.file(/\.ifo$/i)[0];
    const idxEntry = zip.file(/\.idx(\.gz)?$/i)[0];
    const dictEntry = zip.file(/\.dict(\.dz)?$/i)[0];
    if (!ifoEntry || !idxEntry || !dictEntry) {
      throw new Error(
        "The zip file must contain a StarDict dictionary's .ifo, .idx (or .idx.gz), and .dict (or .dict.dz) files.",
      );
    }

    const [ifo, idxRaw, dict] = await Promise.all([
      ifoEntry.async("nodebuffer"),
      idxEntry.async("nodebuffer"),
      dictEntry.async("nodebuffer"),
    ]);
    // Decompressed once here rather than on every later read - qari's StarDictProvider only
    // auto-decompresses a gzip .dict.dz on its own, not a gzip .idx, so an .idx.gz has to already be
    // plain by the time it's stored (the .dict is deliberately left compressed - it's the much
    // larger of the two files, and the provider handles that one itself).
    const idx = idxEntry.name.toLowerCase().endsWith(".gz") ? gunzipSync(idxRaw) : idxRaw;

    // Extracted into a staging folder and swapped into place in one rename, so a failure partway
    // can't leave a half-replaced dictionary behind.
    const dir = starDictDictionariesDir();
    await fs.mkdir(dir, { recursive: true });
    const finalDir = path.join(dir, lang);
    const stagingDir = path.join(dir, `${lang}.tmp`);
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(stagingDir, path.basename(ifoEntry.name)), ifo),
      fs.writeFile(path.join(stagingDir, path.basename(idxEntry.name).replace(/\.gz$/i, "")), idx),
      fs.writeFile(path.join(stagingDir, path.basename(dictEntry.name)), dict),
    ]);
    await fs.rm(finalDir, { recursive: true, force: true });
    await fs.rename(stagingDir, finalDir);
  });

  ipcMain.handle("maktaba:remove-stardict-dictionary", async (_event, language: string) => {
    const lang = sanitizedLanguageOrThrow(language);
    await fs.rm(path.join(starDictDictionariesDir(), lang), { recursive: true, force: true });
  });

  // Returns stardict:// URLs rather than file contents - qari's Reader fetches these itself (see
  // registerStarDictProtocol above), so only these three short strings cross the IPC boundary,
  // never the (potentially tens-of-MB) dictionary bytes themselves.
  ipcMain.handle("maktaba:get-stardict-dictionary-urls", async (_event, language: string) => {
    const lang = sanitizedLanguageOrThrow(language);
    const dir = path.join(starDictDictionariesDir(), lang);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (error) {
      // ENOENT (no dictionary configured for this language) is the expected, silent case - any
      // other failure (permissions, a corrupt folder) is logged instead of looking identical to
      // "nothing configured", since that distinction was hard to debug from the renderer side.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`Failed to read StarDict dictionary folder for "${lang}":`, error);
      }
      return null;
    }

    const ifoName = files.find((f) => f.toLowerCase().endsWith(".ifo"));
    const idxName = files.find((f) => f.toLowerCase().endsWith(".idx"));
    const dictName = files.find((f) => /\.dict(\.dz)?$/i.test(f));
    if (!ifoName || !idxName || !dictName) return null;

    const toUrl = (name: string) => `stardict://${lang}/${encodeURIComponent(name)}`;
    return { ifoUrl: toUrl(ifoName), idxUrl: toUrl(idxName), dictUrl: toUrl(dictName) };
  });

  ipcMain.handle("maktaba:save-cloud-credential", async (_event, ref: string, secret: string) => {
    const id = sanitizedCredentialRefOrThrow(ref);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS-level credential encryption isn't available on this machine.");
    }

    await fs.mkdir(cloudCredentialsDir(), { recursive: true });
    const encrypted = safeStorage.encryptString(secret);
    await fs.writeFile(path.join(cloudCredentialsDir(), `${id}.enc`), encrypted);
  });

  ipcMain.handle("maktaba:get-cloud-credential", async (_event, ref: string) => {
    const id = sanitizedCredentialRefOrThrow(ref);
    try {
      const encrypted = await fs.readFile(path.join(cloudCredentialsDir(), `${id}.enc`));
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  });

  ipcMain.handle("maktaba:delete-cloud-credential", async (_event, ref: string) => {
    const id = sanitizedCredentialRefOrThrow(ref);
    await fs.rm(path.join(cloudCredentialsDir(), `${id}.enc`), { force: true });
  });

  // Cloud: Phase 4/5 (#96/#99) - the interactive OneDrive/Google Drive sign-in step (system browser
  // + loopback listener) can only run here, never in the renderer or the .NET backend. Returns the
  // token set straight to the renderer, same as S3's credential fields - it's responsible for
  // handing them to the backend (to register/verify the library) and to saveCloudCredential (to
  // persist them), rather than introducing a separate credential-handling pattern per provider.
  //
  // Only one attempt per provider is ever tracked at a time (the connect dialog is a singleton) - a
  // fresh call aborts whatever attempt (if any) is still pending before starting its own, so closing
  // the dialog and immediately reopening it to retry can't leak an orphaned listener still waiting
  // on its old port for the rest of the timeout.
  let oneDriveConnectAbort: AbortController | null = null;

  ipcMain.handle("maktaba:connect-onedrive", () => {
    oneDriveConnectAbort?.abort();
    const controller = new AbortController();
    oneDriveConnectAbort = controller;
    return connectOneDrive(controller.signal).finally(() => {
      if (oneDriveConnectAbort === controller) {
        oneDriveConnectAbort = null;
      }
    });
  });

  ipcMain.handle("maktaba:cancel-onedrive-connect", () => {
    oneDriveConnectAbort?.abort();
  });

  let googleDriveConnectAbort: AbortController | null = null;

  ipcMain.handle("maktaba:connect-google-drive", () => {
    googleDriveConnectAbort?.abort();
    const controller = new AbortController();
    googleDriveConnectAbort = controller;
    return connectGoogleDrive(controller.signal).finally(() => {
      if (googleDriveConnectAbort === controller) {
        googleDriveConnectAbort = null;
      }
    });
  });

  // Lets the renderer stop a still-pending sign-in immediately (closing the connect dialog, or a
  // "Cancel" button) instead of it only ever ending via runOAuthLoopback's own multi-minute
  // timeout - see that function's `signal` parameter.
  ipcMain.handle("maktaba:cancel-google-drive-connect", () => {
    googleDriveConnectAbort?.abort();
  });

  // "Log out"/"Remove library" (LibrariesSettings.tsx) - see revokeGoogleDriveToken's own doc
  // comment for what this actually destroys server-side.
  ipcMain.handle("maktaba:revoke-google-drive-token", (_event, refreshToken: string) => revokeGoogleDriveToken(refreshToken));
}
