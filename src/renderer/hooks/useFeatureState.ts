import { useMemo } from "react";
import type { AgentStatus } from "@/components/AgentPanel";
import type { AgentBlockData } from "@/components/AgentBlock";

export type FeatureStatus =
  | "draft"
  | "planned"
  | "in-progress"
  | "review"
  | "done";

/** Which top-level view the feature page should render */
export type FeatureView =
  | "plan-input" // draft, no agents running — show description textarea + Plan/Brainstorm buttons
  | "planning" // plan or brainstorm agent is active/has output
  | "ready-to-build" // planned, no agents active — show Build/Risk/Review buttons
  | "agents-active" // one or more of execute/risk/review agents have output
  | "done"; // feature is done — show summary

export interface AgentVisibility {
  showPlanAgent: boolean;
  showBrainstormAgent: boolean;
  showExecuteAgent: boolean;
  showRiskAgent: boolean;
  showReviewAgent: boolean;
}

export interface ActionAvailability {
  canStartPlan: boolean;
  canStartBrainstorm: boolean;
  canStartBuild: boolean;
  canStartRisk: boolean;
  canStartReview: boolean;
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
  brainstorm: AgentInfo;
  execute: AgentInfo;
  risk: AgentInfo;
  review: AgentInfo;
}

export function useFeatureState(
  params: UseFeatureStateParams,
): FeatureStateResult {
  const { featureStatus, plan, brainstorm, execute, risk, review } = params;

  return useMemo(() => {
    const status = featureStatus ?? "draft";
    const isDraft = status === "draft";
    const isPlanned = status === "planned";
    const isInProgress = status === "in-progress";
    const isReview = status === "review";
    const isDone = status === "done";

    // Agent has output if it has blocks or is not idle
    const hasAgentOutput = (a: AgentInfo) =>
      a.status !== "idle" || a.blocks.length > 0;

    const planActive = hasAgentOutput(plan);
    const brainstormActive = hasAgentOutput(brainstorm);
    const executeActive = hasAgentOutput(execute);
    const riskActive = hasAgentOutput(risk);
    const reviewActive = hasAgentOutput(review);

    // Planning agents are active
    const planningActive = planActive || brainstormActive;

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
      (isPlanned || isInProgress || isReview) &&
      !planningActive
    ) {
      view = "ready-to-build";
    } else {
      view = "plan-input";
    }

    const agents: AgentVisibility = {
      showPlanAgent: planActive,
      showBrainstormAgent: brainstormActive,
      showExecuteAgent: executeActive,
      showRiskAgent: riskActive,
      showReviewAgent: reviewActive,
    };

    const actions: ActionAvailability = {
      canStartPlan:
        isDraft &&
        plan.status === "idle" &&
        brainstorm.status === "idle",
      canStartBrainstorm:
        isDraft &&
        plan.status === "idle" &&
        brainstorm.status === "idle",
      canStartBuild:
        (isPlanned || isInProgress) && (execute.status === "idle" || execute.status === "error"),
      canStartRisk:
        (isPlanned || isInProgress) && risk.status === "idle",
      canStartReview:
        (isInProgress || isReview) && review.status === "idle",
    };

    return { view, agents, actions };
  }, [featureStatus, plan, brainstorm, execute, risk, review]);
}
