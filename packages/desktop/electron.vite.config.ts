import path from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import { rendererCsp } from "./electron/main/csp";
import pkg from "./package.json" with { type: "json" };

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function cspMetaPlugin(isProduction: boolean): Plugin {
  return {
    name: "cadencr-csp-meta",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: rendererCsp(isProduction),
        },
        injectTo: "head",
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const frontendPort = parsePort(env.VITE_FRONTEND_PORT, 1420);
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: path.resolve(__dirname, "electron/main/index.ts"),
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: path.resolve(__dirname, "electron/preload/index.ts"),
        },
      },
    },
    renderer: {
      root: ".",
      envDir: __dirname,
      envPrefix: "VITE_",
      server: {
        host: "127.0.0.1",
        port: frontendPort,
        strictPort: true,
      },
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
        cspMetaPlugin(mode === "production"),
        TanStackRouterVite({
          routesDirectory: "src/routes",
          generatedRouteTree: "src/routeTree.gen.ts",
          routeFileIgnorePattern: ".test.tsx?$",
        }),
      ],
      build: {
        rollupOptions: {
          input: path.resolve(__dirname, "index.html"),
        },
      },
    },
  };
});
