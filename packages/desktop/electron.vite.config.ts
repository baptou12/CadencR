import fs from "node:fs";
import { createRequire } from "node:module";
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

const excalidrawFontsDir = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")),
  "fonts",
);

/**
 * Serves Excalidraw's fonts (Excalifont, Nunito, …) from the renderer origin
 * so they satisfy the `font-src 'self'` CSP — Excalidraw's default CDN fetch is
 * blocked. In dev a middleware streams them from `node_modules`; for the
 * packaged build they're copied into `out/renderer/fonts`. The runtime base is
 * set via `window.EXCALIDRAW_ASSET_PATH` (see `excalidraw-asset-path.ts`).
 */
function excalidrawFontsPlugin(): Plugin {
  let outDir = "";
  return {
    name: "cadencr-excalidraw-fonts",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/fonts/")) return next();
        const rel = decodeURIComponent(req.url.slice("/fonts/".length).split(/[?#]/)[0]);
        const filePath = path.join(excalidrawFontsDir, rel);
        if (!filePath.startsWith(excalidrawFontsDir + path.sep)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) return next();
          if (filePath.endsWith(".woff2")) res.setHeader("Content-Type", "font/woff2");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.end(data);
        });
      });
    },
    closeBundle() {
      if (!outDir) return;
      fs.cpSync(excalidrawFontsDir, path.join(outDir, "fonts"), { recursive: true });
    },
  };
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
        excalidrawFontsPlugin(),
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
