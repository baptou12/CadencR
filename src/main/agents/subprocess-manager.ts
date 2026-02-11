import { ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import { discoverClaudeCli, getResolvedPath } from "./cli-discovery";

const MAX_CONCURRENT = 10;

export interface SubprocessOptions {
  /** Working directory for the Claude CLI process */
  cwd: string;
  /** Agent type identifier */
  agentType: string;
  /** System prompt to pass to Claude */
  systemPrompt?: string;
  /** Initial user message / prompt */
  prompt: string;
  /** Session ID for resuming a previous session */
  resumeSessionId?: string;
  /** Allowed tools configuration */
  allowedTools?: string[];
}

export interface ManagedSubprocess {
  id: string;
  process: ChildProcess;
  agentType: string;
  startedAt: Date;
  status: "running" | "stopped" | "error" | "completed";
}

const activeProcesses = new Map<string, ManagedSubprocess>();

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `agent-${Date.now()}-${idCounter}`;
}

/**
 * Start a new Claude CLI subprocess with stream-json output.
 */
export function startSubprocess(options: SubprocessOptions): ManagedSubprocess {
  if (activeProcesses.size >= MAX_CONCURRENT) {
    throw new Error(`Maximum concurrent agent limit reached (${MAX_CONCURRENT})`);
  }

  const cliInfo = discoverClaudeCli();
  if (!cliInfo) {
    throw new Error(
      "Claude CLI not found. Please install it or configure the path in Settings.",
    );
  }

  const args: string[] = [
    "--output-format",
    "stream-json",
    "--verbose",
  ];

  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  } else {
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }
    // The prompt is passed via stdin as the initial message
    args.push("--print", options.prompt);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    for (const tool of options.allowedTools) {
      args.push("--allowedTools", tool);
    }
  }

  const resolvedPath = getResolvedPath();

  const child = spawn(cliInfo.path, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      PATH: resolvedPath,
      HOME: os.homedir(),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const id = generateId();
  const managed: ManagedSubprocess = {
    id,
    process: child,
    agentType: options.agentType,
    startedAt: new Date(),
    status: "running",
  };

  activeProcesses.set(id, managed);

  child.on("exit", (code) => {
    const entry = activeProcesses.get(id);
    if (entry) {
      entry.status = code === 0 ? "completed" : "error";
    }
  });

  child.on("error", () => {
    const entry = activeProcesses.get(id);
    if (entry) {
      entry.status = "error";
    }
  });

  return managed;
}

/**
 * Kill a running subprocess by ID.
 */
export function killSubprocess(id: string): boolean {
  const managed = activeProcesses.get(id);
  if (!managed || managed.status !== "running") {
    return false;
  }

  managed.process.kill("SIGTERM");
  managed.status = "stopped";
  return true;
}

/**
 * Get a managed subprocess by ID.
 */
export function getSubprocess(id: string): ManagedSubprocess | undefined {
  return activeProcesses.get(id);
}

/**
 * List all active subprocesses.
 */
export function listSubprocesses(): Array<{
  id: string;
  agentType: string;
  startedAt: Date;
  status: string;
}> {
  return Array.from(activeProcesses.values()).map((m) => ({
    id: m.id,
    agentType: m.agentType,
    startedAt: m.startedAt,
    status: m.status,
  }));
}

/**
 * Kill all running subprocesses. Used during app shutdown.
 */
export function killAllSubprocesses(): void {
  for (const [, managed] of activeProcesses) {
    if (managed.status === "running") {
      managed.process.kill("SIGTERM");
      managed.status = "stopped";
    }
  }
}

/**
 * Remove completed/stopped/errored subprocesses from tracking.
 */
export function cleanupSubprocesses(): void {
  for (const [id, managed] of activeProcesses) {
    if (managed.status !== "running") {
      activeProcesses.delete(id);
    }
  }
}

/**
 * Send input to a running subprocess via stdin.
 */
export function sendSubprocessInput(id: string, input: string): boolean {
  const managed = activeProcesses.get(id);
  if (!managed || managed.status !== "running" || !managed.process.stdin) {
    return false;
  }
  managed.process.stdin.write(input + "\n");
  return true;
}

/**
 * Check if any subprocesses are currently running.
 */
export function hasRunningSubprocesses(): boolean {
  for (const [, managed] of activeProcesses) {
    if (managed.status === "running") {
      return true;
    }
  }
  return false;
}
