import { existsSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const executablePathByPlatform = new Map([
  ["darwin", "Electron.app/Contents/MacOS/Electron"],
  ["linux", "electron"],
  ["win32", "electron.exe"],
]);

export function ensureElectronBundle({ electronModulePath, platform = process.platform }) {
  ensurePathFile(electronModulePath, platform);
  if (platform === "darwin") {
    if (isMacBundleMissingRequiredFiles(electronModulePath)) {
      reinstallElectron(electronModulePath);
      ensurePathFile(electronModulePath, platform);
      if (isMacBundleMissingRequiredFiles(electronModulePath)) {
        throw new Error("Electron reinstall completed, but the macOS app bundle is still incomplete.");
      }
    }
    repairMacFrameworkCurrentSymlink(electronModulePath);
  }
}

function ensurePathFile(electronModulePath, platform) {
  const pathFile = join(electronModulePath, "path.txt");
  if (existsSync(pathFile)) return;

  // pnpm can keep Electron's package without its postinstall-generated
  // path.txt in worktrees. electron-vite reads this file to locate the
  // binary, so recreate the deterministic value before requiring Electron.
  const executablePath = executablePathByPlatform.get(platform);
  if (executablePath === undefined) return;

  const distExecutablePath = join(electronModulePath, "dist", executablePath);
  if (existsSync(distExecutablePath)) {
    writeFileSync(pathFile, executablePath, "utf8");
  }
}

function repairMacFrameworkCurrentSymlink(electronModulePath) {
  const versionsPath = join(
    electronModulePath,
    "dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions",
  );
  const currentPath = join(versionsPath, "Current");
  if (existsSync(currentPath)) return;

  // Electron's executable loads `Electron Framework.framework/Electron
  // Framework`, which is a symlink through `Versions/Current`. Some pnpm
  // worktree installs have the app contents but lose this one symlink,
  // producing a dyld "Library not loaded" error even though Versions/A exists.
  const versionAFramework = join(versionsPath, "A/Electron Framework");
  if (existsSync(versionAFramework)) {
    symlinkSync("A", currentPath);
  }
}

function isMacBundleMissingRequiredFiles(electronModulePath) {
  const requiredPaths = [
    "dist/Electron.app/Contents/MacOS/Electron",
    "dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
    "dist/Electron.app/Contents/Frameworks/Mantle.framework/Mantle",
    "dist/Electron.app/Contents/Frameworks/ReactiveObjC.framework/ReactiveObjC",
    "dist/Electron.app/Contents/Frameworks/Squirrel.framework/Squirrel",
  ];
  return requiredPaths.some((relativePath) => !existsSync(join(electronModulePath, relativePath)));
}

function reinstallElectron(electronModulePath) {
  const installScript = join(electronModulePath, "install.js");
  if (!existsSync(installScript)) {
    throw new Error(`Electron install script is missing: ${installScript}`);
  }

  rmSync(join(electronModulePath, "dist"), { recursive: true, force: true });
  rmSync(join(electronModulePath, "path.txt"), { force: true });

  const result = spawnSync(process.execPath, [installScript], {
    cwd: electronModulePath,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Electron reinstall failed with exit code ${result.status ?? "unknown"}`);
  }
}
