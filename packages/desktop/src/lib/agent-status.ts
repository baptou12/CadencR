/**
 * Single shared mapping between the local `TurnLifecycle` (derived from
 * WS turn events) and the canonical `LiveAgentStatus` (backend-pushed on
 * `app/session_status.*`). Used only at the one bootstrap-fallback site
 * in `useWebSocketSession` — every steady-state read should go through
 * `session-status-store`.
 */

import type { LiveAgentStatus } from "@/types/agent";
import type { TurnLifecycle } from "@/stores/ws-turn-lifecycle";

export function liveStatusFromLifecycle(lifecycle: TurnLifecycle): LiveAgentStatus {
  if (lifecycle.phase === "active") return "agent";
  if (lifecycle.phase === "paused") {
    // OS-suspend isn't user-attention-requested — don't render the
    // "Awaiting input" badge during system sleep recovery. The
    // `permission` / `question` / `planApproval` / `user` reasons all
    // do represent a pause the user can act on, so they map to
    // `question` (which paints the message-question icon).
    return lifecycle.reason === "suspended" ? "idle" : "question";
  }
  return "idle";
}
