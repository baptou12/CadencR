/**
 * Risk agent MCP server.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createPhaseTool,
  updatePhaseTool,
  removePhaseTool,
  createAgentDoneTool,
  createFinalizePhasesTool,
} from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

export function createRiskMcpServer(planId: number, featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-risk",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createFinalizePhasesTool(planId, featureId, "mitigation phases"),
    ],
  });
}
