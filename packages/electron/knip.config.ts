import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/main.ts", "src/preload.ts", "src/renderer/main.tsx"],
  project: ["src/**/*.{ts,tsx}"],
  ignore: ["src/renderer/routeTree.gen.ts"],
  ignoreDependencies: ["electron-rebuild"],
};

export default config;
