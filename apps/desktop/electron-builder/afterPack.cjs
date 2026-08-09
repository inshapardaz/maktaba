// electron-builder afterPack hook: dotnet publish output copied via
// extraResources doesn't reliably carry the Unix executable bit when the
// publish/package step runs on a different host OS (e.g. publishing
// linux-x64/osx-x64 output from this Windows dev machine), so set it
// explicitly on non-Windows targets.
const fs = require("fs");
const path = require("path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === "win32") {
    return;
  }

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");

  const exePath = path.join(resourcesDir, "backend", "Maktaba.Api");
  if (fs.existsSync(exePath)) {
    fs.chmodSync(exePath, 0o755);
  }
};
