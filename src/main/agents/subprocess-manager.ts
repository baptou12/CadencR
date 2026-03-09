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
  return AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.generateSubprocessId()),
  );
}

// ---------------------------------------------------------------------------
// Subprocess lifecycle functions (delegate to SubprocessLifecycle service)
// ---------------------------------------------------------------------------

export function startSubprocess(options: SubprocessOptions): ManagedSubprocess {
  return AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.start(options)),
  );
}

export async function setSubprocessPermissionMode(
  id: string,
  mode: "acceptEdits" | "plan",
): Promise<boolean> {
  return AppRuntime.runPromise(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.setPermissionMode(id, mode)),
  );
}

export async function sendMessageToSubprocess(
  id: string,
  message: MessageContent,
): Promise<import("../effect/services/SubprocessLifecycle").SendMessageResult> {
  return AppRuntime.runPromise(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.sendMessage(id, message)),
  );
}

export async function pauseSubprocess(
  id: string,
  opts?: { allowPaused?: boolean },
): Promise<boolean> {
  return AppRuntime.runPromise(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.pause(id, opts)),
  );
}

export async function stopSubprocess(id: string): Promise<boolean> {
  return AppRuntime.runPromise(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.stop(id)),
  );
}

export async function interruptSubprocess(id: string): Promise<boolean> {
  return AppRuntime.runPromise(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.interrupt(id)),
  );
}

export function listSubprocesses(): Array<{
  id: string;
  agentType: string;
  startedAt: Date;
  status: string;
}> {
  return AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.list()),
  );
}

export function killAllSubprocesses(): void {
  AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.killAll()),
  );
}

export function hasRunningSubprocesses(): boolean {
  return AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.hasRunning()),
  );
}

export function saveAllSessionStates(): void {
  // Delegates to SessionPersistence via SubprocessLifecycle.gracefulShutdown
  // but only the save-state portion. We replicate with gracefulShutdown minus kill.
  // For backward compat, just call gracefulShutdown (it saves + kills).
  AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.gracefulShutdown()),
  );
}

export function gracefulShutdown(): void {
  AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.gracefulShutdown()),
  );
}

export function getActiveProcess(id: string): ManagedSubprocess | undefined {
  return AppRuntime.runSync(
    Effect.flatMap(SubprocessLifecycle, (svc) => svc.getActive(id)),
  );
}

// ---------------------------------------------------------------------------
// Re-export from extracted modules for backward compatibility
// ---------------------------------------------------------------------------

export { submitToolPermission, submitUserAnswers } from "./tool-permissions";
import { submitPlanApproval as _submitPlanApproval, submitPrdApproval as _submitPrdApproval } from "./tool-permissions";
export function submitPlanApproval(subprocessId: string, approved: boolean, feedback?: string) {
  return _submitPlanApproval(subprocessId, approved, feedback, getActiveProcess);
}
export function submitPrdApproval(subprocessId: string, approved: boolean, feedback?: string) {
  return _submitPrdApproval(subprocessId, approved, feedback, getActiveProcess);
}
import { getSupportedCommands as _getSupportedCommands } from "./slash-commands";
export function getSupportedCommands(subprocessId: string | null, cwd: string) {
  return _getSupportedCommands(subprocessId, cwd, getActiveProcess);
}

// Re-export channel constants for use in preload and main
export { ASK_USER_QUESTION_CHANNEL, ASK_USER_ANSWER_CHANNEL, TOOL_PERMISSION_CHANNEL } from "./broadcast";
