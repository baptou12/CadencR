import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  define: {
    // Keep process.env as a runtime reference so the preload script can read
    // env vars set by the main process (e.g. CADENCE_RUST_PORT).
    "process.env": "process.env",
  },
});
