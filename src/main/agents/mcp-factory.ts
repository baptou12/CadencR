/**
 * Centralized MCP server factory builder for all agent types.
 *
 * Both the initial agent start (agent-configs.ts) and session resume
 * (router.ts) need to construct the same MCP servers. This module is
 * the single source of truth for which MCP servers each agent type gets.
 */

import {
  createPlanMcpServer,
  createPrdMcpServer,
  createExecuteMcpServer,
  createQaMcpServer,
  createReviewMcpServer,
  createRiskMcpServer,
  createCommonMcpServer,
  createWorkflowSessionMcpServer,
  createRetroMcpServer,
  type OnAgentDoneCallback,
} from "./mcp-tools";
import { getAppRuntime } from "../effect/app-runtime-ref";
import { PlanApproval } from "../effect/services/PlanApproval";
import { getDatabase } from "../db/database";
import type { AgentType, UnifiedAgentConfig } from "./types";

type McpServerFactory = NonNullable<UnifiedAgentConfig["mcpServerFactory"]>;

/**
 * Build the mcpServerFactory for a given agent type.
 *
 * @param agentType - The agent type
 * @param featureId - The feature ID
 * @param planId    - The plan ID (required for plan/qa/review/risk agents;
 *                    optional for session; ignored for others)
 */
export function buildMcpServerFactory(
  agentType: AgentType,
  featureId: number,
  planId?: number,
  onAgentDone?: OnAgentDoneCallback,
): McpServerFactory | undefined {
  switch (agentType) {
    case "plan": {
      if (!planId) return undefined;
      return (subprocessId: string, sessionDbId: number) => ({
        "cadence-plan": createPlanMcpServer(planId, featureId, sessionDbId, async (planMarkdown) => {
          return getAppRuntime().runPromise(
            PlanApproval.waitForPlanApproval(subprocessId, planMarkdown),
          );
        }, onAgentDone),
      });
    }

    case "prd": {
      return (subprocessId: string, sessionDbId: number) => ({
        "cadence-prd": createPrdMcpServer(featureId, sessionDbId, async (prdMarkdown) => {
          return getAppRuntime().runPromise(
            PlanApproval.waitForPrdApproval(subprocessId, prdMarkdown),
          );
        }, onAgentDone),
      });
    }

    case "execute": {
      return (_subprocessId: string, sessionDbId: number) => ({
        "cadence-execute": createExecuteMcpServer(featureId, sessionDbId, onAgentDone),
      });
    }

    case "qa": {
      if (!planId) return undefined;
      return (_subprocessId: string, sessionDbId: number) => ({
        "cadence-qa": createQaMcpServer(planId, featureId, sessionDbId, onAgentDone),
      });
    }

    case "review": {
      if (!planId) return undefined;
      return (_subprocessId: string, sessionDbId: number) => ({
        "cadence-review": createReviewMcpServer(planId, featureId, sessionDbId, onAgentDone),
      });
    }

    case "risk": {
      if (planId) {
        return (_subprocessId: string, sessionDbId: number) => ({
          "cadence-risk": createRiskMcpServer(planId, featureId, sessionDbId),
        });
      }
      return (_subprocessId: string, sessionDbId: number) => ({
        "cadence-common": createCommonMcpServer(sessionDbId, featureId),
      });
    }

    case "session": {
      if (planId) {
        return (_subprocessId: string, sessionDbId: number) => ({
          "cadence-session": createWorkflowSessionMcpServer(
            sessionDbId,
            featureId,
            ["read_plan", "list_phases", "read_phase", "read_prd", "mark_agent_done", "mark_phase_done"],
          ),
        });
      }
      return (_subprocessId: string, sessionDbId: number) => ({
        "cadence-common": createCommonMcpServer(sessionDbId, featureId),
      });
    }

    case "retro": {
      return (_subprocessId: string, sessionDbId: number) => ({
        "cadence-retro": createRetroMcpServer(featureId, sessionDbId),
      });
    }

    case "review-fixer":
      return undefined;

    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Resume helper — resolves planId from DB when not directly available
// ---------------------------------------------------------------------------

function getActivePlanId(featureId: number): number | undefined {
  const db = getDatabase();
  const row = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? AND status IN ('active', 'draft') ORDER BY id DESC LIMIT 1")
    .get(featureId) as { id: number } | undefined;
  return row?.id;
}

function getPlanIdFromPhase(phaseId: number): number | undefined {
  const db = getDatabase();
  const row = db
    .prepare("SELECT plan_id FROM phases WHERE id = ?")
    .get(phaseId) as { plan_id: number } | undefined;
  return row?.plan_id;
}

/**
 * Build an mcpServerFactory for session resume. Resolves planId from the DB
 * since it's not directly available in the resume context.
 */
export function buildMcpServerFactoryForResume(
  agentType: AgentType,
  featureId: number,
  phaseId?: number | null,
  onAgentDone?: OnAgentDoneCallback,
): McpServerFactory | undefined {
  const planId = phaseId
    ? getPlanIdFromPhase(phaseId)
    : getActivePlanId(featureId);
  return buildMcpServerFactory(agentType, featureId, planId, onAgentDone);
}
