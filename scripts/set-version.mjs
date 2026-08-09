#!/usr/bin/env node
// Sets the "version" field in the root, frontend, and desktop package.json
// files so packaged installers/artifacts carry the release version. Used by
// .github/workflows/release.yml before packaging; safe to run locally too.
//
// Usage: node scripts/set-version.mjs 1.2.3

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <semver, e.g. "1.2.3">');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

const targets = [
  path.join(repoRoot, "package.json"),
  path.join(repoRoot, "apps", "frontend", "package.json"),
  path.join(repoRoot, "apps", "desktop", "package.json"),
];

for (const file of targets) {
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`${path.relative(repoRoot, file)} -> ${version}`);
}
