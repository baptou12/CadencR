/**
 * MCP tool servers barrel — re-exports everything previously exported from mcp-tools.ts.
 *
 * The directory import `./mcp-tools` resolves to this index file, preserving
 * the existing import path used by mcp-factory.ts and tests.
 */

export { renderPlanMarkdown } from "./helpers";
export {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createPhaseTool,
  updatePhaseTool,
  removePhaseTool,
  createAgentDoneTool,
  createMarkPhaseDoneTool,
  createFinalizePhasesTool,
} from "./shared-tools";

// Extracted server factories
export { createQaMcpServer } from "./qa-server";
export { createReviewMcpServer } from "./review-server";
export { createRiskMcpServer } from "./risk-server";

// Extracted server factories
export { createPlanMcpServer } from "./plan-server";
export type { PlanApprovalCallback } from "./plan-server";
export { createExecuteMcpServer } from "./execute-server";

// Server factories still in the parent mcp-tools.ts (will be moved in subsequent phases)
export {
  createPrdMcpServer,
  createRetroMcpServer,
  createCommonMcpServer,
  createWorkflowSessionMcpServer,
} from "../mcp-tools";
export type { PrdApprovalCallback } from "../mcp-tools";
