/**
 * subprocess-manager.ts — thin compatibility wrapper
 *
 * All subprocess lifecycle logic has been moved to the SubprocessLifecycle
 * Effect service (src/main/effect/services/SubprocessLifecycle.ts).
 *
 * This module exists solely to maintain backward-compatible export signatures
 * so that callers (trpc/agents.ts, unified-agent.ts, src/main.ts) continue
 * to work without modification.
 *
 * Each exported function calls into the AppRuntime to run the corresponding
 * Effect service method synchronously or asynchronously as needed.
 */

import { Effect } from "effect";
import { AppRuntime } from "../effect/runtime";
import { SubprocessLifecycle } from "../effect/services/SubprocessLifecycle";
import type { ManagedSubprocess, SubprocessOptions, MessageContent } from "./types";

export type { ManagedSubprocess, SubprocessOptions };

export type { SendMessageResult } from "../effect/services/SubprocessLifecycle";

/** Pre-generate a subprocess ID for use before startSubprocess is called. */
export function generateSubprocessId(): string {
  return AppRuntime.runSync(SubprocessLifecycle.generateSubprocessId());
}

// ---------------------------------------------------------------------------
// Subprocess lifecycle functions (delegate to SubprocessLifecycle service)
// ---------------------------------------------------------------------------

export function startSubprocess(options: SubprocessOptions): ManagedSubprocess {
  return AppRuntime.runSync(SubprocessLifecycle.start(options));
}

export async function setSubprocessPermissionMode(
  id: string,
  mode: "acceptEdits" | "plan",
): Promise<boolean> {
  return AppRuntime.runPromise(SubprocessLifecycle.setPermissionMode(id, mode));
}

export async function sendMessageToSubprocess(
  id: string,
  message: MessageContent,
): Promise<import("../effect/services/SubprocessLifecycle").SendMessageResult> {
  return AppRuntime.runPromise(SubprocessLifecycle.sendMessage(id, message));
}

export async function pauseSubprocess(
  id: string,
  opts?: { allowPaused?: boolean },
): Promise<boolean> {
  return AppRuntime.runPromise(SubprocessLifecycle.pause(id, opts));
}

export async function stopSubprocess(id: string): Promise<boolean> {
  return AppRuntime.runPromise(SubprocessLifecycle.stop(id));
}

export async function interruptSubprocess(id: string): Promise<boolean> {
  return AppRuntime.runPromise(SubprocessLifecycle.interrupt(id));
}

export function listSubprocesses(): Array<{
  id: string;
  agentType: string;
  startedAt: Date;
  status: string;
}> {
  return AppRuntime.runSync(SubprocessLifecycle.list());
}

export function killAllSubprocesses(): void {
  AppRuntime.runSync(SubprocessLifecycle.killAll());
}

export function hasRunningSubprocesses(): boolean {
  return AppRuntime.runSync(SubprocessLifecycle.hasRunning());
}

export function saveAllSessionStates(): void {
  // Delegates to SessionPersistence via SubprocessLifecycle.gracefulShutdown
  // but only the save-state portion. We replicate with gracefulShutdown minus kill.
  // For backward compat, just call gracefulShutdown (it saves + kills).
  AppRuntime.runSync(SubprocessLifecycle.gracefulShutdown());
}

export function gracefulShutdown(): void {
  AppRuntime.runSync(SubprocessLifecycle.gracefulShutdown());
}

export function getActiveProcess(id: string): ManagedSubprocess | undefined {
  return AppRuntime.runSync(SubprocessLifecycle.getActive(id));
}

// ---------------------------------------------------------------------------
// Re-export from extracted modules for backward compatibility
// ---------------------------------------------------------------------------

export { submitToolPermission, submitUserAnswers } from "./tool-permissions";
import { getAppRuntime } from "../effect/app-runtime-ref";
import { PlanApproval } from "../effect/services/PlanApproval";
export function submitPlanApproval(subprocessId: string, approved: boolean, feedback?: string): { success: boolean; error?: string } {
  getAppRuntime().runSync(
    Effect.flatMap(PlanApproval, (pa) => pa.submitPlanApproval(subprocessId, approved, feedback)),
  );
  return { success: true };
}
export function submitPrdApproval(subprocessId: string, approved: boolean, feedback?: string): { success: boolean; error?: string } {
  getAppRuntime().runSync(
    Effect.flatMap(PlanApproval, (pa) => pa.submitPrdApproval(subprocessId, approved, feedback)),
  );
  return { success: true };
}
import { SlashCommands } from "../effect/services/SlashCommands";
export function getSupportedCommands(subprocessId: string | null, cwd: string) {
  let activeQuery: { supportedCommands(): Promise<unknown[]> } | undefined;
  if (subprocessId) {
    const managed = getActiveProcess(subprocessId);
    if (managed?.query && managed.status !== "stopped" && managed.status !== "error") {
      activeQuery = managed.query;
    }
  }
  return AppRuntime.runPromise(
    Effect.flatMap(SlashCommands, (svc) => svc.getCommands(cwd, activeQuery)),
  );
}

// Re-export channel constants for use in preload and main
export { ASK_USER_QUESTION_CHANNEL, ASK_USER_ANSWER_CHANNEL, TOOL_PERMISSION_CHANNEL } from "./broadcast";
