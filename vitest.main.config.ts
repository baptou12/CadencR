import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/main/**/*.test.ts"],
    setupFiles: ["src/main/test-setup.ts"],
    server: {
      deps: {
        external: ["better-sqlite3", "node-pty"],
      },
    },
  },
});
