/**
 * Shared types and utilities for WorkflowBackend adapters.
 * Extracted to avoid circular dependencies between useWorkflowBackend and its adapters.
 */

import type { FeatureSession } from "./useFeatureAgentState";
import type { AgentStatus } from "@/types/agent";
import type {
  WorkflowStatus,
  WorktreeStatus,
  QueueItem,
  AutonomyLevel,
} from "./useWorkflowWebSocket";
import type { ActionAvailability } from "./useFeatureState";

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

export type ViewState =
  | "loading"
  | "plan-input"
  | "planning"
  | "prd"
  | "plan-approval"
  | "ready-to-build"
  | "agents-active"
  | "paused"
  | "done";

/**
 * Pure function that derives the current view state from workflow status and
 * session list. Used by both adapters so the logic is shared.
 */
export function deriveViewState(
  status: WorkflowStatus,
  sessions: FeatureSession[],
): ViewState {
  // If sessions exist, never show plan-input — the feature has been worked on
  const hasSessions = sessions.length > 0;

  switch (status) {
    case "idle":
      return hasSessions ? "agents-active" : "plan-input";
    case "planning":
      return "planning";
    case "prd":
      return "prd";
    case "plan_approval":
      return "plan-approval";
    case "ready_to_build":
      return "ready-to-build";
    case "building":
      return "agents-active";
    case "paused":
      return hasSessions ? "agents-active" : "paused";
    case "completed":
      return "done";
    case "error": {
      const hasActive = sessions.some(
        (s) => s.status === "running" || s.status === "waiting",
      );
      return hasActive || hasSessions ? "agents-active" : "plan-input";
    }
    default:
      return hasSessions ? "agents-active" : "plan-input";
  }
}

// ---------------------------------------------------------------------------
// WorkflowBackend interface
// ---------------------------------------------------------------------------

export interface WorkflowBackend {
  // -- Read state --
  workflowStatus: WorkflowStatus;
  sessionEntries: FeatureSession[];
  planSession: FeatureSession | null;
  prdSession: FeatureSession | null;
  /** null for legacy (sidebar uses this to decide PlanSidebar vs QueueSidebar) */
  queue: QueueItem[] | null;
  autonomyLevel: AutonomyLevel;
  error: string | null;
  clearError: () => void;

  // -- Derived state --
  hasAnyAgentOutput: boolean;
  noAgentsRunning: boolean;
  view: ViewState;
  isLoading: boolean;

  // -- Action availability (from useFeatureState or equivalent) --
  actions: ActionAvailability;

  // -- Loading flags --
  isStartingPlan: boolean;
  isStartingPrd: boolean;
  isStartingExecute: boolean;
  isStartingRisk: boolean;
  isStartingReview: boolean;
  isStartingRetro: boolean;
  isContinuingBuild: boolean;
  isStartingWorkflowSession: boolean;
  isStartingRefinePlan: boolean;
  canContinueBuild: boolean;
  executeWaitingNextStep: number | null;
  executeStatus: AgentStatus;
  planApprovalError: string | null;

  // -- Commands --
  startPlan(description: string, images?: Array<{ base64: string; mimeType: string }>): void;
  startPrd(description: string, images?: Array<{ base64: string; mimeType: string }>): void;
  approvePlan(
    subprocessId?: string | null,
    sessionDbId?: number,
    requestId?: string,
  ): void;
  rejectPlan(
    feedback: string,
    subprocessId?: string | null,
    sessionDbId?: number,
    requestId?: string,
  ): void;
  startBuilding(): void;
  continueWorkflow(): void;
  sendToAgent(
    entry: FeatureSession,
    message: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ): void;
  stopAgent(entry: FeatureSession): void;
  interruptAgent(entry: FeatureSession): void;
  submitPermission(
    entry: FeatureSession,
    decision: string,
    feedback?: string,
  ): void;
  submitAnswers(entry: FeatureSession, response: string): void;
  startSession(prompt: string, images?: string[]): void;
  startRefine(description: string, images?: string[]): void;
  startRisk(): void;
  startReview(): void;
  startRetro(): void;
  startReviewFixer(comments: string): void;
  markDone(sessionDbId: number): void;
  deleteSession(sessionDbId: number): void;
  handleResume(agentType: string, sessionDbId: number): void;

  // -- Lazy history loading (WS only) --
  loadAgentHistory?(entry: FeatureSession): void;

  // -- Queue-specific (optional) --
  skipItem?(itemId: number): void;
  retryItem?(itemId: number): void;
  setAutonomyLevel?(level: AutonomyLevel): void;
  setParallelExecution?(enabled: boolean): void;
  selectItem?(itemId: number): void;
  selectedItemId?: number | null;

  // -- Worktree state (WS only, null for HTTP polling) --
  worktreeStatus?: WorktreeStatus;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  worktreeSetupOutput?: string[];
  worktreeError?: string | null;

  // -- Refs/callbacks --
  refetch?(): void;
}
