import path from "path";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Branch detection is a build-time concern; unit tests drive
    // `resolveAppEnvironmentKind` directly instead.
    __APP_BUILD_BRANCH__: JSON.stringify(""),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx", "src/**/*.test.ts", "electron/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    pool: "forks",
    teardownTimeout: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
