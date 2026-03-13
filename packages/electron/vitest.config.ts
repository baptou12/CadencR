import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["vitest.main.config.ts", "vitest.renderer.config.ts"],
  },
});
