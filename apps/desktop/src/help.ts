import { app, ipcMain } from "electron";
import { promises as fs } from "fs";
import path from "path";

type HelpLocale = "en" | "ur";

interface HelpTopicMeta {
  slug: string;
  title: string;
}

// Packaged: apps/desktop/resources/help/ (populated by scripts/build-help-content.mjs before
// electron-builder runs, wired via the top-level extraResources entry in package.json). Dev:
// reads straight from the repo's docs/ source, exactly like sidecar.ts runs the backend via
// `dotnet run` against source instead of a published copy in dev — no separate copy step needed
// for local iteration.
function helpContentRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "help")
    : path.join(__dirname, "..", "..", "..", "docs");
}

function topicPath(locale: HelpLocale, slug: string): string {
  return path.join(helpContentRoot(), locale, `${slug}.md`);
}

function firstHeading(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

async function listTopicsDev(locale: HelpLocale): Promise<HelpTopicMeta[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { helpTopics } = require(path.join(helpContentRoot(), "topics.cjs")) as {
    helpTopics: { slug: string; title: Record<HelpLocale, string> }[];
  };
  return helpTopics.map((topic) => ({ slug: topic.slug, title: topic.title[locale] }));
}

async function listTopicsPackaged(locale: HelpLocale): Promise<HelpTopicMeta[]> {
  const manifestPath = path.join(helpContentRoot(), locale, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as HelpTopicMeta[];
}

/**
 * Offline help content (docs/{en,ur}/*.md) for the in-app Help tab (HelpSettings.tsx). Exposed
 * to the renderer via ipcRenderer.invoke + preload's contextBridge, same convention as every
 * other filesystem access in this app (see native.ts) - the renderer never reads files directly.
 */
export function registerHelpHandlers(): void {
  ipcMain.handle("maktaba:list-help-topics", async (_event, locale: HelpLocale) => {
    try {
      return app.isPackaged ? await listTopicsPackaged(locale) : await listTopicsDev(locale);
    } catch {
      return [];
    }
  });

  ipcMain.handle("maktaba:read-help-topic", async (_event, locale: HelpLocale, slug: string) => {
    try {
      const markdown = await fs.readFile(topicPath(locale, slug), "utf8");
      return { title: firstHeading(markdown, slug), bodyMarkdown: markdown };
    } catch {
      return null;
    }
  });

  ipcMain.handle("maktaba:read-help-asset", async (_event, relativePath: string) => {
    try {
      // relativePath comes from a markdown image src this same content authored (e.g.
      // "../screenshots/gs-welcome.png") - normalize and confine it to helpContentRoot() so a
      // malformed reference can't escape into the rest of the filesystem.
      const root = helpContentRoot();
      const resolved = path.normalize(path.join(root, "screenshots", path.basename(relativePath)));
      if (!resolved.startsWith(path.join(root, "screenshots"))) {
        return null;
      }
      const data = await fs.readFile(resolved);
      const ext = path.extname(resolved).slice(1).toLowerCase();
      const mime = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  });
}
