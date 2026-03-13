import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "main",
    environment: "node",
    include: ["src/main/**/*.test.ts"],
    setupFiles: ["src/main/test-setup.ts"],
    globalSetup: ["src/main/test-global-setup.ts"],
    server: {
      deps: {
        external: ["better-sqlite3", "node-pty"],
      },
    },
  },
});
