// electron-builder afterPack hook: the cargo-built backend binary copied via extraResources
// doesn't reliably carry the Unix executable bit, so set it explicitly on non-Windows targets.
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

  const exePath = path.join(resourcesDir, "backend", "maktaba-api");
  if (fs.existsSync(exePath)) {
    fs.chmodSync(exePath, 0o755);
  }
};
