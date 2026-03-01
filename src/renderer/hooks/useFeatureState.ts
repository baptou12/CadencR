import { useMemo } from "react";
import type { AgentStatus } from "@/types/agent";
import type { AgentBlockData } from "@/components/AgentBlock";

export type FeatureStatus =
  | "draft"
  | "planned"
  | "in-progress"
  | "done"
  | "archived";

/** Which top-level view the feature page should render */
export type FeatureView =
  | "plan-input" // draft, no agents running — show description textarea + Plan/PRD buttons
  | "planning" // plan or prd agent is active/has output
  | "ready-to-build" // planned, no agents active — show Build/Risk/Review buttons
  | "agents-active" // one or more of execute/risk/review agents have output
  | "done"; // feature is done — show summary

export interface AgentVisibility {
  showPlanAgent: boolean;
  showPrdAgent: boolean;
  showExecuteAgent: boolean;
  showRiskAgent: boolean;
  showReviewAgent: boolean;
}

export interface ActionAvailability {
  canStartPlan: boolean;
  canStartPrd: boolean;
  canStartBuild: boolean;
  canStartRisk: boolean;
  canStartReview: boolean;
  canStartWorkflowSession: boolean;
  canStartRefine: boolean;
  canStartRetro: boolean;
}

export interface FeatureStateResult {
  view: FeatureView;
  agents: AgentVisibility;
  actions: ActionAvailability;
}

interface AgentInfo {
  status: AgentStatus;
  blocks: AgentBlockData[];
}

interface UseFeatureStateParams {
  featureStatus: FeatureStatus | undefined;
  plan: AgentInfo;
  prd: AgentInfo;
  execute: AgentInfo;
  risk: AgentInfo;
  review: AgentInfo;
}

export function useFeatureState(
  params: UseFeatureStateParams,
): FeatureStateResult {
  const { featureStatus, plan, prd, execute, risk, review } = params;

  return useMemo(() => {
    const status = featureStatus ?? "draft";
    const isDraft = status === "draft";
    const isPlanned = status === "planned";
    const isInProgress = status === "in-progress";
    const isDone = status === "done" || status === "archived";

    // Agent has output if it has blocks or is not idle
    const hasAgentOutput = (a: AgentInfo) =>
      a.status !== "idle" || a.blocks.length > 0;

    const planActive = hasAgentOutput(plan);
    const prdActive = hasAgentOutput(prd);
    const executeActive = hasAgentOutput(execute);
    const riskActive = hasAgentOutput(risk);
    const reviewActive = hasAgentOutput(review);

    // Planning agents are active
    const planningActive = planActive || prdActive;

    // Build/risk/review agents are active
    const buildPhaseAgentsActive =
      executeActive || riskActive || reviewActive;

    // Determine the view
    let view: FeatureView;
    if (isDone && !buildPhaseAgentsActive) {
      view = "done";
    } else if (planningActive) {
      view = "planning";
    } else if (buildPhaseAgentsActive) {
      view = "agents-active";
    } else if (
      (isPlanned || isInProgress) &&
      !planningActive
    ) {
      view = "ready-to-build";
    } else {
      view = "plan-input";
    }

    const agents: AgentVisibility = {
      showPlanAgent: planActive,
      showPrdAgent: prdActive,
      showExecuteAgent: executeActive,
      showRiskAgent: riskActive,
      showReviewAgent: reviewActive,
    };

    const actions: ActionAvailability = {
      canStartPlan:
        isDraft &&
        plan.status === "idle" &&
        (prd.status === "idle" || prd.status === "completed"),
      canStartPrd:
        isDraft &&
        plan.status === "idle" &&
        prd.status === "idle",
      canStartBuild:
        (isPlanned || isInProgress) && (execute.status === "idle" || execute.status === "error" || execute.status === "completed"),
      canStartRisk:
        (isPlanned || isInProgress) && risk.status !== "running",
      canStartReview:
        isInProgress && review.status !== "running",
      canStartWorkflowSession:
        isPlanned || isInProgress || isDone,
      canStartRefine:
        isPlanned || isInProgress || isDone,
      canStartRetro:
        isDone,
    };

    return { view, agents, actions };
  }, [featureStatus, plan, prd, execute, risk, review]);
}
