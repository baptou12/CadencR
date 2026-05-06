import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const electronModulePath = dirname(require.resolve("electron"));
const pathFile = join(electronModulePath, "path.txt");
const executablePathByPlatform = new Map([
  ["darwin", "Electron.app/Contents/MacOS/Electron"],
  ["linux", "electron"],
  ["win32", "electron.exe"],
]);

if (!existsSync(pathFile)) {
  // pnpm can keep Electron's package without its postinstall-generated path.txt
  // in worktrees. electron-vite reads this file to locate the binary, so we
  // recreate the deterministic value before requiring Electron.
  const executablePath = executablePathByPlatform.get(process.platform);
  const distExecutablePath =
    executablePath === undefined ? undefined : join(electronModulePath, "dist", executablePath);

  if (executablePath !== undefined && distExecutablePath !== undefined && existsSync(distExecutablePath)) {
    writeFileSync(pathFile, executablePath, "utf8");
  }
}

require("electron");
