/**
 * Execute agent MCP server.
 */

import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import {
  readPlanTool,
  readPhaseTool,
  listPhasesTool,
  createAgentDoneTool,
  createMarkPhaseDoneTool,
} from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

export function createExecuteMcpServer(featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "cadence-execute",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createMarkPhaseDoneTool(featureId),
    ],
  });
}
