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

function waitForHealth(port: number, timeoutMs = 15000): Promise<void> {
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

/**
 * Dev-mode launch: `dotnet run` against the backend project directly.
 * Packaged-app launch (M4) will instead spawn the self-contained published
 * executable bundled as an electron-builder extraResource.
 */
export async function startSidecar(): Promise<SidecarHandle> {
  const port = await getFreePort();
  const token = crypto.randomBytes(24).toString("hex");

  const backendProjectPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "backend",
    "Maktaba.Api",
  );

  const child = spawn(
    "dotnet",
    [
      "run",
      "--no-launch-profile",
      "--project",
      backendProjectPath,
      "--",
      `--port=${port}`,
      `--token=${token}`,
    ],
    { stdio: "inherit" },
  );

  child.on("error", (err) => {
    console.error("Failed to start Maktaba.Api sidecar:", err);
  });

  await waitForHealth(port);

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
