/**
 * Slash command discovery — fetches supported commands from the Claude CLI.
 * Extracted from subprocess-manager.ts.
 */

import { Effect, Option } from "effect";
import { discoverClaudeCli } from "./cli-discovery";
import { getSdkClient, type SdkQuery } from "./sdk-client";
import type { ManagedSubprocess } from "./types";

export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

/** Custom app-level commands (not from the SDK) */
const CUSTOM_COMMANDS: SlashCommandInfo[] = [
  { name: "clear", description: "Clear conversation context and start fresh" },
];

/** Cache for slash commands keyed by cwd */
const commandsCache = new Map<string, { commands: SlashCommandInfo[]; timestamp: number }>();
const COMMANDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Track in-flight fetches to avoid duplicate temporary subprocesses */
const commandsFetching = new Map<string, Promise<SlashCommandInfo[]>>();

function mapCommands(commands: Array<{ name: string; description: string; argumentHint?: string }>): SlashCommandInfo[] {
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
  }));
}

/**
 * Get supported slash commands.
 * If a subprocess ID is provided and active, uses its Query object.
 * Otherwise spawns a temporary subprocess to fetch commands, then closes it.
 */
export async function getSupportedCommands(
  subprocessId: string | null,
  cwd: string,
  getActiveProcess?: (id: string) => ManagedSubprocess | undefined,
): Promise<SlashCommandInfo[]> {
  const sdkCommands = await getSdkCommands(subprocessId, cwd, getActiveProcess);
  return [...CUSTOM_COMMANDS, ...sdkCommands];
}

async function getSdkCommands(
  subprocessId: string | null,
  cwd: string,
  getActiveProcess?: (id: string) => ManagedSubprocess | undefined,
): Promise<SlashCommandInfo[]> {
  // 1. Try existing subprocess first
  if (subprocessId && getActiveProcess) {
    const managed = getActiveProcess(subprocessId);
    if (managed?.query && managed.status !== "stopped" && managed.status !== "error") {
      try {
        const result = mapCommands(await managed.query.supportedCommands());
        commandsCache.set(cwd, { commands: result, timestamp: Date.now() });
        return result;
      } catch (err) {
        console.error(`[slash-commands] getSupportedCommands error for subprocess ${subprocessId}:`, err);
      }
    }
  }

  // 2. Check cache
  const cached = commandsCache.get(cwd);
  if (cached && Date.now() - cached.timestamp < COMMANDS_CACHE_TTL) {
    return cached.commands;
  }

  // 3. Deduplicate in-flight fetches for this cwd
  const inflight = commandsFetching.get(cwd);
  if (inflight) return inflight;

  // 4. Spawn a temporary subprocess to fetch commands
  const fetchPromise = fetchCommandsViaTemporaryQuery(cwd);
  commandsFetching.set(cwd, fetchPromise);
  try {
    const result = await fetchPromise;
    commandsCache.set(cwd, { commands: result, timestamp: Date.now() });
    return result;
  } finally {
    commandsFetching.delete(cwd);
  }
}

/**
 * Spawn a short-lived SDK query solely to call supportedCommands(), then close it.
 */
async function fetchCommandsViaTemporaryQuery(cwd: string): Promise<SlashCommandInfo[]> {
  const sdk = await getSdkClient();

  const cliInfoOpt = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));
  if (Option.isNone(cliInfoOpt)) return [];
  const cliInfo = cliInfoOpt.value;

  // Async iterable that never yields — keeps the subprocess alive until close()
  const neverYield: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<unknown>>(() => {}) };
    },
  };

  let queryObj: SdkQuery | null = null;
  try {
    queryObj = sdk.query({
      prompt: neverYield,
      options: { cwd, permissionMode: "acceptEdits", pathToClaudeCodeExecutable: cliInfo.path },
    });
    return mapCommands(await queryObj.supportedCommands() as SlashCommandInfo[]);
  } catch (err) {
    console.error("[slash-commands] fetchCommandsViaTemporaryQuery error:", err);
    return [];
  } finally {
    try { queryObj?.close(); } catch { /* already closed */ }
  }
}
