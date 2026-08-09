import { contextBridge } from "electron";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const port = getArg("maktaba-port");
const token = getArg("maktaba-token");

if (!port || !token) {
  throw new Error(
    "Maktaba preload: missing --maktaba-port/--maktaba-token additionalArguments from main process",
  );
}

contextBridge.exposeInMainWorld("maktaba", {
  apiBaseUrl: `http://127.0.0.1:${port}`,
  token,
});
