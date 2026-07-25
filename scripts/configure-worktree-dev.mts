import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseEnv as parseEnvText } from "node:util";
import { fileURLToPath } from "node:url";
import { gitCommonDir, listGitWorktrees } from "./git-worktrees.mts";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(scriptPath));

interface CheckoutFiles {
  repoEnv: string;
  desktopEnv: string;
  serviceEnv: string;
  database: string;
}

interface PortAssignment {
  frontendPort: number;
  servicePort: number;
  remotePort: number;
}

interface CheckoutDevConfig {
  profileSuffix: string | undefined;
  frontendPort: number | null;
  apiPort: number | null;
  serviceFrontendPort: number | null;
  servicePort: number | null;
  remotePort: number | null;
}

interface ConfigureWorktreeDevOptions {
  currentRoot: string;
  mainRoot: string;
  worktreeRoots: string[];
  lockPath: string;
  listeningPorts?: ReadonlySet<number>;
}

interface ChooseAssignmentOptions {
  currentRoot: string;
  worktreeRoots: string[];
  listeningPorts: ReadonlySet<number>;
}

function envPaths(root: string): CheckoutFiles {
  return {
    repoEnv: join(root, ".env"),
    desktopEnv: join(root, "packages", "desktop", ".env"),
    serviceEnv: join(root, "packages", "service", ".env"),
    database: join(root, "packages", "service", "cadencr.local.db"),
  };
}

function readEnv(filePath: string): Record<string, string | undefined> {
  if (!existsSync(filePath)) return {};
  return parseEnvText(readFileSync(filePath, "utf8"));
}

function validPort(value: string | undefined): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function urlPort(value: string | undefined): number | null {
  if (!value) return null;
  try {
    return validPort(new URL(value).port);
  } catch {
    return null;
  }
}

function readDevConfig(root: string): CheckoutDevConfig {
  const files = envPaths(root);
  const desktop = readEnv(files.desktopEnv);
  const service = readEnv(files.serviceEnv);
  return {
    profileSuffix: desktop.CADENCR_DEV_USER_DATA_SUFFIX,
    frontendPort: validPort(desktop.VITE_FRONTEND_PORT),
    apiPort: urlPort(desktop.VITE_API_URL),
    serviceFrontendPort: validPort(service.CADENCR_FRONTEND_PORT),
    servicePort: validPort(service.CADENCR_RUST_PORT),
    remotePort: validPort(service.CADENCR_REMOTE_PORT),
  };
}

function assignmentFromConfig(root: string, config: CheckoutDevConfig): PortAssignment | null {
  const { frontendPort, servicePort, remotePort } = config;
  if (
    config.profileSuffix !== basename(root) ||
    frontendPort === null ||
    servicePort === null ||
    remotePort === null ||
    config.serviceFrontendPort !== frontendPort ||
    config.apiPort !== servicePort
  ) {
    return null;
  }
  return { frontendPort, servicePort, remotePort };
}

function reservePorts(root: string, reserved: Set<number>): void {
  const config = readDevConfig(root);
  const candidates = Object.values(config).filter(
    (value): value is number => typeof value === "number",
  );
  for (const port of candidates) {
    reserved.add(port);
  }
}

export function parseListeningPorts(output: string): Set<number> {
  const ports = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^n.*:(\d+)$/);
    const port = validPort(match?.[1]);
    if (port !== null) ports.add(port);
  }
  return ports;
}

function listeningPorts(): Set<number> {
  const command = existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof";
  const result = spawnSync(command, ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fn"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("lsof failed while listing listening TCP ports");
  }
  return parseListeningPorts(result.stdout);
}

function nextPort(start: number, reserved: Set<number>, listening: ReadonlySet<number>): number {
  for (let port = start; port <= 65535; port += 1) {
    if (reserved.has(port) || listening.has(port)) continue;
    reserved.add(port);
    return port;
  }
  throw new Error(`No free TCP port available from ${start}`);
}

function setEnvValues(filePath: string, values: Record<string, string | number>): void {
  let text = readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(text)) text = text.replace(pattern, line);
    else text = `${text.replace(/\s*$/, "")}\n${line}\n`;
  }
  writeFileSync(filePath, text);
}

function copyBaseFiles(mainRoot: string, currentRoot: string): CheckoutFiles {
  const source = envPaths(mainRoot);
  const target = envPaths(currentRoot);
  for (const filePath of [source.repoEnv, source.desktopEnv, source.serviceEnv]) {
    if (!existsSync(filePath)) throw new Error(`Missing main-checkout file: ${filePath}`);
  }
  copyFileSync(source.repoEnv, target.repoEnv);
  copyFileSync(source.desktopEnv, target.desktopEnv);
  copyFileSync(source.serviceEnv, target.serviceEnv);
  if (!existsSync(target.database)) {
    if (!existsSync(source.database)) {
      throw new Error(`Missing main-checkout file: ${source.database}`);
    }
    copyFileSync(source.database, target.database);
  }
  return target;
}

async function acquireLock(lockPath: string): Promise<() => void> {
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      mkdirSync(lockPath);
      return () => rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${lockPath}; remove it if no setup process is running`,
      );
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

function chooseAssignment({
  currentRoot,
  worktreeRoots,
  listeningPorts,
}: ChooseAssignmentOptions): PortAssignment {
  const reserved = new Set<number>();
  for (const root of worktreeRoots) {
    if (resolve(root) !== currentRoot) reservePorts(root, reserved);
  }
  const previous = assignmentFromConfig(currentRoot, readDevConfig(currentRoot));
  if (
    previous &&
    !reserved.has(previous.frontendPort) &&
    !reserved.has(previous.servicePort) &&
    !reserved.has(previous.remotePort)
  ) {
    return previous;
  }
  return {
    frontendPort: nextPort(1421, reserved, listeningPorts),
    servicePort: nextPort(5100, reserved, listeningPorts),
    remotePort: nextPort(6100, reserved, listeningPorts),
  };
}

function writeAssignment(
  files: CheckoutFiles,
  currentRoot: string,
  assignment: PortAssignment,
): void {
  setEnvValues(files.desktopEnv, {
    VITE_FRONTEND_PORT: assignment.frontendPort,
    VITE_API_URL: `http://127.0.0.1:${assignment.servicePort}`,
    CADENCR_DEV_USER_DATA_SUFFIX: basename(currentRoot),
  });
  setEnvValues(files.serviceEnv, {
    CADENCR_FRONTEND_PORT: assignment.frontendPort,
    CADENCR_RUST_PORT: assignment.servicePort,
    CADENCR_REMOTE_PORT: assignment.remotePort,
  });
}

export async function configureWorktreeDev({
  currentRoot,
  mainRoot,
  worktreeRoots,
  lockPath,
  listeningPorts: activeListeningPorts,
}: ConfigureWorktreeDevOptions): Promise<PortAssignment> {
  currentRoot = resolve(currentRoot);
  mainRoot = resolve(mainRoot);
  const knownRoots = worktreeRoots.map((root) => resolve(root));
  if (currentRoot === mainRoot) {
    throw new Error(
      "dev:configure-worktree must run from a linked worktree, not the main checkout",
    );
  }
  if (!knownRoots.includes(currentRoot)) {
    throw new Error(`Current checkout is not registered as a Git worktree: ${currentRoot}`);
  }
  activeListeningPorts ??= listeningPorts();

  const releaseLock = await acquireLock(lockPath);
  try {
    const assignment = chooseAssignment({
      currentRoot,
      worktreeRoots: knownRoots,
      listeningPorts: activeListeningPorts,
    });
    const files = copyBaseFiles(mainRoot, currentRoot);
    writeAssignment(files, currentRoot, assignment);
    return assignment;
  } finally {
    releaseLock();
  }
}

async function main(): Promise<void> {
  const commonDir = gitCommonDir(repoRoot);
  const mainRoot = dirname(commonDir);
  const assignment = await configureWorktreeDev({
    currentRoot: realpathSync(repoRoot),
    mainRoot: realpathSync(mainRoot),
    worktreeRoots: listGitWorktrees(repoRoot),
    lockPath: join(commonDir, "cadencr-dev-port-allocation.lock"),
  });
  console.log("Configured worktree development endpoints:");
  console.log(`  renderer: http://127.0.0.1:${assignment.frontendPort}`);
  console.log(`  service:  http://127.0.0.1:${assignment.servicePort}`);
  console.log(`  remote port: ${assignment.remotePort}`);
  console.log(`  profile:  ${basename(repoRoot)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
