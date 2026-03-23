import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import path from "node:path";

const config: ForgeConfig = {
  packagerConfig: {
    icon: path.join(__dirname, "assets", "icon"),
    extraResource: [
      process.platform === "win32"
        ? path.join(__dirname, "..", "..", "target", "release", "cadence-service.exe")
        : path.join(__dirname, "..", "..", "target", "release", "cadence-service"),
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
