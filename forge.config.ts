import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "**/{better-sqlite3,bindings,file-uri-to-path}/**",
    },
    afterCopy: [
      (buildPath, electronVersion, _platform, arch, callback) => {
        // Install native dependencies in the packaged app directory
        const packageJsonPath = path.join(buildPath, "package.json");
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        // Only keep native dependencies for production install
        pkg.dependencies = {
          "better-sqlite3": pkg.dependencies["better-sqlite3"],
          bindings: pkg.dependencies["bindings"] || "*",
          "file-uri-to-path":
            pkg.dependencies["file-uri-to-path"] || "*",
        };
        delete pkg.devDependencies;
        fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));
        execSync("npm install --production --ignore-scripts", {
          cwd: buildPath,
          stdio: "inherit",
        });
        // Rebuild native modules against Electron's Node.js headers
        const rebuildBin = path.resolve(
          __dirname,
          "node_modules/.bin/electron-rebuild",
        );
        execSync(
          `"${rebuildBin}" --version "${electronVersion}" --arch "${arch}" --module-dir "${buildPath}" --only better-sqlite3`,
          {
            cwd: buildPath,
            stdio: "inherit",
          },
        );
        callback();
      },
    ],
  },
  rebuildConfig: {},
  makers: [new MakerZIP({})],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
