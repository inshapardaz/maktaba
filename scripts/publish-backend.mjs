#!/usr/bin/env node
// Publishes the Maktaba.Api backend as a self-contained executable per RID,
// into apps/desktop/resources/backend/<rid>/ — the layout electron-builder's
// per-platform `extraResources` in apps/desktop/package.json expects.
//
// Usage:
//   node scripts/publish-backend.mjs                 # host RID only (fast, for local packaging)
//   node scripts/publish-backend.mjs --all            # all four shipping RIDs
//   node scripts/publish-backend.mjs win-x64 linux-x64 # specific RIDs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const csproj = path.join(repoRoot, "backend", "Maktaba.Api", "Maktaba.Api.csproj");
const outRoot = path.join(repoRoot, "apps", "desktop", "resources", "backend");

const ALL_RIDS = ["win-x64", "osx-x64", "osx-arm64", "linux-x64"];

function hostRid() {
  const plat = os.platform();
  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  if (plat === "win32") return "win-x64";
  if (plat === "darwin") return arch === "arm64" ? "osx-arm64" : "osx-x64";
  return "linux-x64";
}

const args = process.argv.slice(2);
const rids = args.includes("--all") ? ALL_RIDS : args.length > 0 ? args : [hostRid()];

for (const rid of rids) {
  if (!ALL_RIDS.includes(rid)) {
    console.error(`Unknown RID "${rid}". Expected one of: ${ALL_RIDS.join(", ")}`);
    process.exit(1);
  }
}

for (const rid of rids) {
  const outDir = path.join(outRoot, rid);
  console.log(`\n--- Publishing Maktaba.Api for ${rid} -> ${path.relative(repoRoot, outDir)} ---`);

  const result = spawnSync(
    "dotnet",
    [
      "publish",
      csproj,
      "-c",
      "Release",
      "-r",
      rid,
      "--self-contained",
      "true",
      "-o",
      outDir,
      "-p:PublishSingleFile=false",
      "-p:UseAppHost=true",
    ],
    { stdio: "inherit", cwd: repoRoot },
  );

  if (result.status !== 0) {
    console.error(`dotnet publish failed for ${rid}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nDone.");
