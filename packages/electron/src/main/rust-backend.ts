import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { app } from "electron";
import http from "node:http";

const DEFAULT_PORT = 5005;

let rustProcess: ChildProcess | null = null;
let currentPort: number = DEFAULT_PORT;

function getBinaryPath(): string {
  if (app.isPackaged) {
    const binaryName =
      process.platform === "win32" ? "cadence-service.exe" : "cadence-service";
    return path.join(process.resourcesPath, binaryName);
  }
  // Dev mode: use cargo build output
  const binaryName =
    process.platform === "win32" ? "cadence-service.exe" : "cadence-service";
  return path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "target",
    "debug",
    binaryName,
  );
}

function healthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function startRustBackend(
  dbPath: string,
  port: number = DEFAULT_PORT,
  electronPort?: number,
): Promise<void> {
  currentPort = port;
  const binaryPath = getBinaryPath();

  console.log(`[rust-backend] Starting: ${binaryPath}`);
  console.log(`[rust-backend] DB path: ${dbPath}, port: ${port}`);

  const args = ["--db-path", dbPath, "--port", String(port)];
  if (electronPort != null) {
    args.push("--electron-port", String(electronPort));
  }

  rustProcess = spawn(binaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      RUST_LOG: process.env.RUST_LOG ?? "cadence_service=debug,claude_agent_sdk_rs=debug",
    },
  });

  rustProcess.stdout?.on("data", (data: Buffer) => {
    console.log(`[rust-backend] ${data.toString().trimEnd()}`);
  });

  rustProcess.stderr?.on("data", (data: Buffer) => {
    console.error(`[rust-backend] ${data.toString().trimEnd()}`);
  });

  // Wait for health check
  const maxRetries = 30;
  const retryInterval = 200;

  for (let i = 0; i < maxRetries; i++) {
    // Check if process exited unexpectedly
    if (rustProcess.exitCode !== null) {
      const exitCode = rustProcess.exitCode;
      rustProcess = null;
      throw new Error(
        `Rust backend exited unexpectedly with code ${exitCode}`,
      );
    }

    if (await healthCheck(port)) {
      console.log(`[rust-backend] Started on port ${port}`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }

  // Timeout — gracefully stop then force kill
  console.log("[rust-backend] Health check timeout, sending SIGTERM...");
  rustProcess.kill("SIGTERM");
  const exitedGracefully = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 2000);
    rustProcess!.on("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    if (rustProcess!.exitCode !== null) {
      clearTimeout(timeout);
      resolve(true);
    }
  });
  if (!exitedGracefully) {
    console.log("[rust-backend] Force killing after SIGTERM timeout...");
    rustProcess.kill("SIGKILL");
  }
  rustProcess = null;
  throw new Error("Rust backend failed to start: health check timeout after 6 seconds");
}

export async function stopRustBackend(): Promise<void> {
  if (!rustProcess) return;

  const proc = rustProcess;
  rustProcess = null;

  console.log("[rust-backend] Stopping...");
  proc.kill("SIGTERM");

  // Wait up to 5 seconds for exit
  const exited = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    // If already exited
    if (proc.exitCode !== null) {
      clearTimeout(timeout);
      resolve(true);
    }
  });

  if (!exited) {
    console.log("[rust-backend] Force killing...");
    proc.kill("SIGKILL");
  }

  console.log("[rust-backend] Stopped");
}

export function getRustBackendPort(): number {
  return currentPort;
}
