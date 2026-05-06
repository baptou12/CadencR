import { spawn, type ChildProcessByStdio } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";

const SIDECAR_PORT = 5004;
const HEALTH_RETRIES = 60;
const HEALTH_INTERVAL_MS = 500;
const DEFAULT_DEV_API_BASE_URL = "http://127.0.0.1:5005";

interface HealthBody {
  service?: string;
}

type ServiceProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface SidecarHandle {
  baseUrl: string;
  authToken: string | null;
  stop: () => Promise<void>;
}

function normalizeBaseUrl(key: string, value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${key} must use http:// or https://`);
  }
  if (!parsed.hostname) throw new Error(`${key} must include a host`);
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error(`${key} must not include a path, query, or fragment`);
  }
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${parsed.hostname}${port}`;
}

export function createDevSidecarHandle(): SidecarHandle {
  const rawBaseUrl = process.env.VITE_API_URL ?? DEFAULT_DEV_API_BASE_URL;
  const authToken = process.env.VITE_API_TOKEN?.trim() || null;
  return {
    baseUrl: normalizeBaseUrl("VITE_API_URL", rawBaseUrl),
    authToken,
    stop: () => Promise.resolve(),
  };
}

function productionDbPath(): string {
  const dbPath = path.join(os.homedir(), ".cadencr", "database", "cadencr.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return dbPath;
}

function productionBinaryPath(): string {
  const binaryName = process.platform === "win32" ? "cadencr-service.exe" : "cadencr-service";
  return path.join(process.resourcesPath, binaryName);
}

function generateAuthToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function spawnProductionSidecar(): Promise<SidecarHandle> {
  const baseUrl = `http://127.0.0.1:${SIDECAR_PORT}`;
  const authToken = generateAuthToken();
  await assertPortAvailable(SIDECAR_PORT);
  const child = spawnService(productionBinaryPath(), productionDbPath(), authToken);
  let exited = false;
  child.on("exit", (code, signal) => {
    exited = true;
    console.info(`[cadencr-service] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  pumpLogs(child);
  await waitForHealthy(baseUrl, authToken, () => exited);
  return {
    baseUrl,
    authToken,
    stop: () => stopChild(child),
  };
}

function spawnService(binary: string, dbPath: string, authToken: string): ServiceProcess {
  return spawn(binary, serviceArgs(dbPath), {
    env: { ...process.env, CADENCR_AUTH_TOKEN: authToken },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function serviceArgs(dbPath: string): string[] {
  return ["--db-path", dbPath, "--port", String(SIDECAR_PORT)];
}

async function assertPortAvailable(port: number): Promise<void> {
  const available = await isPortAvailable(port);
  if (!available) {
    throw new Error(`cadencr-service cannot start because 127.0.0.1:${port} is already in use.`);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function pumpLogs(child: ServiceProcess): void {
  child.stdout.on("data", (chunk: Buffer) => {
    console.info(`[cadencr-service] ${chunk.toString("utf8").trimEnd()}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    console.warn(`[cadencr-service] ${chunk.toString("utf8").trimEnd()}`);
  });
}

async function stopChild(child: ServiceProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 2_000)) return;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

function waitForExit(child: ServiceProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function waitForHealthy(
  baseUrl: string,
  authToken: string,
  hasExited: () => boolean,
): Promise<void> {
  const url = `${baseUrl}/api/health`;
  for (let retry = 0; retry < HEALTH_RETRIES; retry++) {
    if (hasExited()) {
      throw new Error(`cadencr-service exited before passing health check at ${baseUrl}`);
    }
    if (await probeHealth(url, authToken, retry)) return;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }
  throw new Error(`Health check failed after ${HEALTH_RETRIES} retries at ${baseUrl}`);
}

async function probeHealth(url: string, authToken: string, retry: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { "x-cadencr-token": authToken },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as HealthBody;
    if (body.service !== "cadencr") {
      throw new Error(`Health responder identified itself as '${body.service ?? ""}'`);
    }
    console.info(`Health check passed after ${retry} retries`);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Health responder")) throw error;
    return false;
  }
}
