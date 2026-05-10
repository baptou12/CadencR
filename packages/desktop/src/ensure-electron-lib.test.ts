import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runEnsureElectronBundle(electronModulePath: string): void {
  const libPath = resolve(process.cwd(), "scripts/ensure-electron-lib.mjs");
  const code = [
    `const { ensureElectronBundle } = await import(${JSON.stringify(`file://${libPath}`)});`,
    `ensureElectronBundle({ electronModulePath: ${JSON.stringify(electronModulePath)}, platform: "darwin" });`,
  ].join("\n");
  execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

function writeFakeElectronExecutable(electronModulePath: string): void {
  mkdirSync(join(electronModulePath, "dist/Electron.app/Contents/MacOS"), { recursive: true });
  writeFileSync(join(electronModulePath, "dist/Electron.app/Contents/MacOS/Electron"), "");
}

function writeFrameworkExecutable(electronModulePath: string, frameworkName: string): void {
  const frameworkPath = join(
    electronModulePath,
    `dist/Electron.app/Contents/Frameworks/${frameworkName}.framework`,
  );
  mkdirSync(frameworkPath, { recursive: true });
  writeFileSync(join(frameworkPath, frameworkName), "");
}

function writeElectronFrameworkVersionA(electronModulePath: string): string {
  const versionsPath = join(
    electronModulePath,
    "dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions",
  );
  mkdirSync(join(versionsPath, "A"), { recursive: true });
  writeFileSync(join(versionsPath, "A/Electron Framework"), "");
  return versionsPath;
}

function writeCompleteMacElectronBundle(electronModulePath: string): string {
  writeFakeElectronExecutable(electronModulePath);
  writeFrameworkExecutable(electronModulePath, "Squirrel");
  writeFrameworkExecutable(electronModulePath, "Mantle");
  writeFrameworkExecutable(electronModulePath, "ReactiveObjC");
  return writeElectronFrameworkVersionA(electronModulePath);
}

describe("ensure-electron-lib", () => {
  it("repairs a macOS Electron framework with a missing Current symlink", () => {
    const electronModulePath = mkdtempSync(join(tmpdir(), "cadencr-electron-"));
    try {
      writeFileSync(join(electronModulePath, "package.json"), "{}");
      const versionsPath = writeCompleteMacElectronBundle(electronModulePath);
      symlinkSync(
        "Versions/Current/Electron Framework",
        join(
          electronModulePath,
          "dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework",
        ),
      );

      runEnsureElectronBundle(electronModulePath);

      expect(readlinkSync(join(versionsPath, "Current"))).toBe("A");
    } finally {
      rmSync(electronModulePath, { recursive: true, force: true });
    }
  });

  it("reinstalls a macOS Electron bundle that is missing required frameworks", () => {
    const electronModulePath = mkdtempSync(join(tmpdir(), "cadencr-electron-"));
    try {
      writeFakeElectronExecutable(electronModulePath);
      writeFileSync(join(electronModulePath, "path.txt"), "Electron.app/Contents/MacOS/Electron");
      writeFileSync(
        join(electronModulePath, "install.js"),
        `
          const fs = require("node:fs");
          const path = require("node:path");
          const root = __dirname;
          const writeFile = (relativePath) => {
            const filePath = path.join(root, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, "");
          };
          writeFile("dist/Electron.app/Contents/MacOS/Electron");
          writeFile("dist/Electron.app/Contents/Frameworks/Squirrel.framework/Squirrel");
          writeFile("dist/Electron.app/Contents/Frameworks/Mantle.framework/Mantle");
          writeFile("dist/Electron.app/Contents/Frameworks/ReactiveObjC.framework/ReactiveObjC");
          writeFile("dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework");
          fs.symlinkSync(
            "Versions/Current/Electron Framework",
            path.join(root, "dist/Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework")
          );
          fs.writeFileSync(path.join(root, "path.txt"), "Electron.app/Contents/MacOS/Electron");
        `,
      );

      runEnsureElectronBundle(electronModulePath);

      expect(
        existsSync(
          join(
            electronModulePath,
            "dist/Electron.app/Contents/Frameworks/Squirrel.framework/Squirrel",
          ),
        ),
      ).toBe(true);
    } finally {
      rmSync(electronModulePath, { recursive: true, force: true });
    }
  });
});
