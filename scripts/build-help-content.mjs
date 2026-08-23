#!/usr/bin/env node
// Packages docs/{en,ur}/*.md + docs/screenshots into apps/desktop/resources/help/, the layout
// electron-builder's top-level `extraResources` in apps/desktop/package.json expects — mirrors
// scripts/publish-backend.mjs's role as a pre-packaging asset-generation step (not part of
// build:frontend/build:desktop). The in-app Help viewer reads this same content at runtime via
// IPC (apps/desktop/src/help.ts); in dev mode it reads straight from docs/ instead, so this
// script only needs to run before packaging, not during `npm run dev`.
//
// Usage:
//   node scripts/build-help-content.mjs

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { helpTopics, locales } from "../docs/topics.cjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const docsRoot = path.join(repoRoot, "docs");
const outRoot = path.join(repoRoot, "apps", "desktop", "resources", "help");

async function main() {
  await fs.rm(outRoot, { recursive: true, force: true });
  await fs.mkdir(outRoot, { recursive: true });

  for (const locale of locales) {
    const outDir = path.join(outRoot, locale);
    await fs.mkdir(outDir, { recursive: true });

    const manifest = [];
    for (const topic of helpTopics) {
      const src = path.join(docsRoot, locale, `${topic.slug}.md`);
      const dest = path.join(outDir, `${topic.slug}.md`);
      await fs.copyFile(src, dest);
      manifest.push({ slug: topic.slug, title: topic.title[locale] });
    }
    await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(`Packaged ${manifest.length} topics for locale "${locale}"`);
  }

  const screenshotsOut = path.join(outRoot, "screenshots");
  await fs.mkdir(screenshotsOut, { recursive: true });
  const screenshotsSrc = path.join(docsRoot, "screenshots");
  for (const entry of await fs.readdir(screenshotsSrc, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith("_")) {
      await fs.copyFile(path.join(screenshotsSrc, entry.name), path.join(screenshotsOut, entry.name));
    }
  }
  console.log(`Packaged screenshots -> ${path.relative(repoRoot, screenshotsOut)}`);

  console.log(`\nDone. Help content written to ${path.relative(repoRoot, outRoot)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
