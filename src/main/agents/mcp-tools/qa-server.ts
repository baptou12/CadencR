/**
 * QA agent MCP server.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createPhaseTool,
  updatePhaseTool,
  removePhaseTool,
  createMarkPhaseDoneTool,
  createAgentDoneTool,
  createFinalizePhasesTool,
} from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

export function createQaMcpServer(planId: number, featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "cadence-qa",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createMarkPhaseDoneTool(featureId),
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createFinalizePhasesTool(planId, featureId, "phases"),
    ],
  });
}
