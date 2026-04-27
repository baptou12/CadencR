import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(packageDir, ".env");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readFrontendPort() {
  const value = process.env.VITE_FRONTEND_PORT;
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(
      "Missing required `VITE_FRONTEND_PORT` in `packages/tauri/.env`. Copy `packages/tauri/.env.example` to `packages/tauri/.env` and set a port.",
    );
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail("`VITE_FRONTEND_PORT` in `packages/tauri/.env` must be an integer between 1 and 65535.");
  }

  return port;
}

try {
  process.loadEnvFile(envPath);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    fail(
      "Missing required dev env file `packages/tauri/.env`. Copy `packages/tauri/.env.example` to `packages/tauri/.env`.",
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  fail(`Failed to load \`packages/tauri/.env\`: ${message}`);
}

const frontendPort = readFrontendPort();
const config = {
  build: {
    devUrl: `http://127.0.0.1:${frontendPort}`,
    beforeDevCommand: "pnpm vite dev",
  },
  bundle: {
    icon: [
      "icons/dev/32x32.png",
      "icons/dev/128x128.png",
      "icons/dev/128x128@2x.png",
      "icons/dev/icon.icns",
      "icons/dev/icon.ico",
    ],
  },
};

const child = spawn("pnpm", ["tauri", "dev", "-c", JSON.stringify(config)], {
  cwd: packageDir,
  stdio: "inherit",
});

child.on("error", (error) => {
  fail(`Failed to launch Tauri dev: ${error.message}`);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
