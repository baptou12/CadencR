/**
 * Shared workflow types still consumed by ws-session UI surfaces.
 *
 * Most ws-feature-specific types (WorkflowStatus, QueueItem, AgentSessionState,
 * FeatureSnapshot, AgentSlot, etc.) were removed along with the ws-feature
 * stack — only the worktree lifecycle enum survives because ws-session reuses
 * the same worktree setup flow.
 */

export type WorktreeStatus =
  | "idle"
  | "creating"
  | "created"
  | "setup_running"
  | "ready"
  | "setup_error";
