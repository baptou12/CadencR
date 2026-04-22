import type { AgentStatus } from "@/types/agent";

export type TurnPauseReason = "permission" | "question" | "planApproval" | "user";
export type TurnTerminalReason = "completed" | "denied" | "cleared" | "streamClosed";

export type TurnLifecycle =
  | { phase: "idle" }
  | { phase: "active" }
  | { phase: "paused"; reason: TurnPauseReason }
  | { phase: "terminal"; reason: TurnTerminalReason }
  | { phase: "error"; message?: string };

export type TurnEvent =
  | { type: "prompt_sent" }
  | { type: "initialized" }
  | { type: "permission_requested" }
  | { type: "question_requested" }
  | { type: "plan_approval_requested" }
  | { type: "question_answered" }
  | { type: "plan_approved" }
  | { type: "plan_changes_requested" }
  | { type: "turn_ended"; reason: TurnTerminalReason }
  | { type: "turn_cleared" }
  | { type: "turn_errored"; message?: string }
  | { type: "connection_lost" }
  | { type: "stream_activity" };

export function createIdleTurnLifecycle(): TurnLifecycle {
  return { phase: "idle" };
}

export function transitionTurn(current: TurnLifecycle, event: TurnEvent): TurnLifecycle {
  switch (event.type) {
    case "prompt_sent":
      return { phase: "active" };
    case "initialized":
      return current.phase === "active" ? current : { phase: "idle" };
    case "permission_requested":
      return { phase: "paused", reason: "permission" };
    case "question_requested":
      return { phase: "paused", reason: "question" };
    case "plan_approval_requested":
      return { phase: "paused", reason: "planApproval" };
    case "question_answered":
      return current.phase === "terminal" ? current : { phase: "active" };
    case "plan_approved":
    case "plan_changes_requested":
      return current.phase === "terminal" ? current : { phase: "active" };
    case "turn_ended":
      return current.phase === "terminal" ? current : { phase: "terminal", reason: event.reason };
    case "turn_cleared":
      return { phase: "idle" };
    case "turn_errored":
      return { phase: "error", ...(event.message ? { message: event.message } : {}) };
    case "connection_lost":
      if (current.phase === "active") {
        return { phase: "terminal", reason: "streamClosed" };
      }
      return current;
    case "stream_activity":
      return current.phase === "active" ? current : { phase: "active" };
  }
}

export function lifecycleToStatus(lifecycle: TurnLifecycle): AgentStatus {
  switch (lifecycle.phase) {
    case "idle":
      return "idle";
    case "active":
      return "running";
    case "paused":
      return "paused";
    case "error":
      return "error";
    case "terminal":
      return lifecycle.reason === "completed" ? "completed" : "idle";
  }
}

export function persistedStatusToLifecycle(
  status: AgentStatus,
  pendingPlanApproval: unknown,
): TurnLifecycle {
  if (pendingPlanApproval != null) {
    return { phase: "paused", reason: "planApproval" };
  }

  switch (status) {
    case "paused":
      return { phase: "paused", reason: "user" };
    case "completed":
      return { phase: "terminal", reason: "completed" };
    case "error":
      return { phase: "error" };
    default:
      return { phase: "idle" };
  }
}

export function isTurnActive(lifecycle: TurnLifecycle): boolean {
  return lifecycle.phase === "active";
}
