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
  | "plan-input"
  | "planning"
  | "prd"
  | "plan-approval"
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
  switch (status) {
    case "idle":
      return "plan-input";
    case "planning":
      return "planning";
    case "prd":
      return "prd";
    case "plan_approval":
      return "plan-approval";
    case "building":
      return "agents-active";
    case "paused":
      return "paused";
    case "completed":
      return "done";
    case "error": {
      // If there are active sessions, show agents view; otherwise plan-input
      const hasActive = sessions.some(
        (s) => s.status === "running" || s.status === "waiting",
      );
      return hasActive ? "agents-active" : "plan-input";
    }
    default:
      return "plan-input";
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
  reviewVerdict: "changes_requested" | null;
  /** null for legacy (sidebar uses this to decide PlanSidebar vs QueueSidebar) */
  queue: QueueItem[] | null;
  autonomyLevel: AutonomyLevel;
  error: string | null;

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
  isStartingFix: boolean;
  isContinuingBuild: boolean;
  isStartingWorkflowSession: boolean;
  isStartingRefinePlan: boolean;
  isAddingFixPhase: boolean;
  canContinueBuild: boolean;
  executeWaitingNextStep: number | null;
  executeStatus: AgentStatus;
  planApprovalError: string | null;

  // -- Commands --
  startPlan(description: string, images?: string[]): void;
  startPrd(description: string, images?: string[]): void;
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
    images?: string[],
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
  addFixPhase?(): void;
  fixImmediately?(): void;
  markDone(sessionDbId: number): void;
  deleteSession(sessionDbId: number): void;
  handleResume(agentType: string, sessionDbId: number): void;

  // -- Lazy history loading (WS only) --
  loadAgentHistory?(entry: FeatureSession): void;

  // -- Queue-specific (optional) --
  skipItem?(itemId: number): void;
  retryItem?(itemId: number): void;
  setAutonomyLevel?(level: AutonomyLevel): void;
  selectItem?(itemId: number): void;
  selectedItemId?: number | null;

  // -- Worktree state (WS only, null for tRPC) --
  worktreeStatus?: WorktreeStatus;
  worktreePath?: string | null;
  worktreeBranch?: string | null;
  worktreeSetupOutput?: string[];
  worktreeError?: string | null;

  // -- Refs/callbacks --
  refetch?(): void;
}
