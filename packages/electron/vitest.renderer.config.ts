import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "renderer",
    environment: "jsdom",
    include: ["src/renderer/**/*.test.tsx", "src/renderer/**/*.test.ts"],
    setupFiles: ["src/renderer/test-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer"),
    },
  },
});
