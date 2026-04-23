import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import pkg from "./package.json" with { type: "json" };

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const frontendPort = parsePort(env.VITE_FRONTEND_PORT, 1420);

  return {
    envDir: __dirname,
    server: {
      host: "127.0.0.1",
      port: frontendPort,
      strictPort: true,
    },
    envPrefix: "VITE_",
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      TanStackRouterVite({
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
        routeFileIgnorePattern: ".test.tsx?$",
      }),
    ],
  };
});
