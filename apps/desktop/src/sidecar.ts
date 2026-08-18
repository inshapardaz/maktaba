import { spawn, ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as path from "node:path";

export interface SidecarHandle {
  process: ChildProcess;
  port: number;
  token: string;
}

/** Pushed to renderer windows via IPC (see main.ts's broadcastSidecarStatus) so the frontend
 * can show a loading screen until the backend answers /health, or an error if it never does. */
export type SidecarStatus =
  | { state: "starting" }
  | { state: "ready" }
  | { state: "error"; message: string };

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("Could not determine a free port"));
      }
    });
  });
}

export function waitForHealth(port: number, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/health", timeout: 1000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() > deadline) {
        reject(
          new Error(
            `Maktaba.Api did not become healthy on port ${port} within ${timeoutMs}ms`,
          ),
        );
        return;
      }
      setTimeout(attempt, 300);
    };

    attempt();
  });
}

export interface SidecarOptions {
  /** true in a packaged (installed) build, false when running via `npm run dev`. */
  isPackaged: boolean;
  /** Electron's `process.resourcesPath`; only used when `isPackaged` is true. */
  resourcesPath: string;
}

function packagedExecutablePath(resourcesPath: string): string {
  const exeName = process.platform === "win32" ? "maktaba-api.exe" : "maktaba-api";
  return path.join(resourcesPath, "backend", exeName);
}

function devExecutablePath(): string {
  const exeName = process.platform === "win32" ? "maktaba-api.exe" : "maktaba-api";
  return path.join(__dirname, "..", "..", "..", "backend-rust", "target", "debug", exeName);
}

/**
 * Spawns the backend but does not wait for it to become healthy — callers that need to know
 * when it's actually ready to serve requests should separately await `waitForHealth(port)`.
 * Splitting these lets the Electron window appear (and the frontend show its own loading
 * state) immediately instead of the whole app staying window-less during backend startup.
 *
 * Dev mode: the `cargo build`-produced debug binary at backend-rust/target/debug/ - run
 * `cargo build` (or `cargo run`, which also builds) in backend-rust/ before `npm run dev` so this
 * exists.
 * Packaged mode: spawn the release binary bundled as an electron-builder extraResource under
 * `resources/backend/` (see apps/desktop/package.json's `build.win/mac/linux.extraResources` and
 * scripts/publish-backend.mjs), alongside its bundled pdfium shared library (needed for PDF cover
 * rendering - see backend-rust/README.md).
 */
export async function startSidecar(options: SidecarOptions): Promise<SidecarHandle> {
  const port = await getFreePort();
  const token = crypto.randomBytes(24).toString("hex");

  const exePath = options.isPackaged
    ? packagedExecutablePath(options.resourcesPath)
    : devExecutablePath();

  const child = spawn(exePath, [`--port=${port}`, `--token=${token}`], {
    stdio: "inherit",
    windowsHide: true,
  });

  child.on("error", (err) => {
    console.error("Failed to start Maktaba.Api sidecar:", err);
  });

  return { process: child, port, token };
}

export function stopSidecar(handle: SidecarHandle | null): void {
  if (!handle || handle.process.killed || handle.process.exitCode !== null) {
    return;
  }

  handle.process.kill();

  const forceKillTimer = setTimeout(() => {
    if (handle.process.exitCode === null) {
      handle.process.kill("SIGKILL");
    }
  }, 3000);

  handle.process.once("exit", () => clearTimeout(forceKillTimer));
}
