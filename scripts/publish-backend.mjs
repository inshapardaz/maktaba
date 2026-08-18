#!/usr/bin/env node
// Builds the Rust maktaba-api backend in release mode and stages it into
// apps/desktop/resources/backend/<rid>/ — the layout electron-builder's per-platform
// `extraResources` in apps/desktop/package.json expects. Also copies the pdfium shared library
// (see backend-rust/README.md) into the same directory, since maktaba-metadata loads it from next
// to the running executable.
//
// Cross-compiling to a *different OS* than the one this script runs on isn't set up here (Rust
// needs a matching linker/SDK per target OS, unlike `dotnet publish -r <rid>`) - build each
// platform's release on that platform (e.g. a CI matrix), one host RID at a time.
//
// Usage:
//   node scripts/publish-backend.mjs                 # host RID only (fast, for local packaging)
//   node scripts/publish-backend.mjs win-x64          # a specific RID (must match the host OS)

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const cargoRoot = path.join(repoRoot, "backend-rust");
const outRoot = path.join(repoRoot, "apps", "desktop", "resources", "backend");
const pdfiumRoot = path.join(repoRoot, "backend-rust", "vendor", "pdfium");

// win-x64 resolves to whichever Windows target the active Rust toolchain actually defaults to
// (see resolveWindowsTarget) rather than a hardcoded triple: a normal dev machine with Visual
// Studio Build Tools installed defaults to *-pc-windows-msvc (the right choice - smaller/faster,
// no MinGW runtime dependency), but an environment without admin rights to install those Build
// Tools (linker requires elevation) may have been set up against *-pc-windows-gnu instead (a
// portable MinGW-w64 GCC, no elevation needed) - see backend-rust/README.md.
const RID_TO_TARGET = {
  "win-x64": resolveWindowsTarget(),
  "osx-x64": "x86_64-apple-darwin",
  "osx-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
};

function resolveWindowsTarget() {
  const fallback = "x86_64-pc-windows-msvc";
  const result = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return fallback;
  }
  const match = result.stdout.match(/^host:\s*(\S+)/m);
  return match && match[1].includes("pc-windows") ? match[1] : fallback;
}

function hostRid() {
  const plat = os.platform();
  const arch = os.arch() === "arm64" ? "arm64" : "x64";
  if (plat === "win32") return "win-x64";
  if (plat === "darwin") return arch === "arm64" ? "osx-arm64" : "osx-x64";
  return "linux-x64";
}

const args = process.argv.slice(2);
const rids = args.length > 0 ? args : [hostRid()];
const host = hostRid();

for (const rid of rids) {
  if (!RID_TO_TARGET[rid]) {
    console.error(`Unknown RID "${rid}". Expected one of: ${Object.keys(RID_TO_TARGET).join(", ")}`);
    process.exit(1);
  }
  if (rid !== host) {
    console.error(
      `Cannot build "${rid}" on this host (${host}) - Rust cross-OS compilation needs a matching ` +
        `target linker/SDK that isn't set up here. Build this RID on a ${rid} machine instead.`,
    );
    process.exit(1);
  }
}

for (const rid of rids) {
  const target = RID_TO_TARGET[rid];
  const outDir = path.join(outRoot, rid);
  console.log(`\n--- Building maktaba-api (${target}) -> ${path.relative(repoRoot, outDir)} ---`);

  const result = spawnSync("cargo", ["build", "--release", "--target", target, "-p", "maktaba-api"], {
    stdio: "inherit",
    cwd: cargoRoot,
  });
  if (result.status !== 0) {
    console.error(`cargo build failed for ${target}`);
    process.exit(result.status ?? 1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const exeName = rid === "win-x64" ? "maktaba-api.exe" : "maktaba-api";
  const builtExe = path.join(cargoRoot, "target", target, "release", exeName);
  fs.copyFileSync(builtExe, path.join(outDir, exeName));

  const pdfiumDir = path.join(pdfiumRoot, rid);
  if (fs.existsSync(pdfiumDir)) {
    for (const file of fs.readdirSync(pdfiumDir)) {
      fs.copyFileSync(path.join(pdfiumDir, file), path.join(outDir, file));
    }
  } else {
    console.warn(
      `\nWarning: no pdfium library found at ${path.relative(repoRoot, pdfiumDir)} - PDF cover ` +
        `thumbnails will silently be skipped in this build. See backend-rust/README.md.`,
    );
  }
}

console.log("\nDone.");
