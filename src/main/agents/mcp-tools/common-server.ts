/**
 * Common and workflow-session MCP servers.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { queryOne } from "../../db/query";
import { textResult } from "./helpers";
import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createAgentDoneTool,
  createMarkPhaseDoneTool,
} from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

// ---------------------------------------------------------------------------
// Common MCP server (for agents without dedicated servers: Session)
// ---------------------------------------------------------------------------

export function createCommonMcpServer(sessionDbId: number, featureId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-common",
    tools: [
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
    ],
  });
}

// ---------------------------------------------------------------------------
// Workflow session MCP server (read-only plan tools + mark_agent_done)
// ---------------------------------------------------------------------------

export type WorkflowSessionToolName = "read_plan" | "list_phases" | "read_phase" | "read_prd" | "mark_agent_done" | "mark_phase_done";

function createReadPrdTool(featureId: number) {
  return tool("read_prd", "Read the PRD for this feature.", {}, async () => {
    const row = queryOne<{ prd: string | null }>(
      "SELECT prd FROM features WHERE id = ?",
      featureId,
    ).toUndefined();
    if (!row?.prd) return textResult("No PRD exists for this feature.");
    return textResult(row.prd);
  });
}

export function createWorkflowSessionMcpServer(
  sessionDbId: number,
  featureId: number,
  allowedTools: WorkflowSessionToolName[],
) {
  const toolMap = {
    read_plan: readPlanTool,
    list_phases: listPhasesTool,
    read_phase: readPhaseTool,
    read_prd: createReadPrdTool(featureId),
    mark_agent_done: createAgentDoneTool(sessionDbId, featureId),
    mark_phase_done: createMarkPhaseDoneTool(featureId),
  };
  return createSdkMcpServer({
    name: "productdevr-session",
    tools: allowedTools.map((name) => toolMap[name]),
  });
}
