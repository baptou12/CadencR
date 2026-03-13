/**
 * MCP tool servers barrel — re-exports everything previously exported from mcp-tools.ts.
 *
 * The directory import `./mcp-tools` resolves to this index file, preserving
 * the existing import path used by mcp-factory.ts and tests.
 */

export { renderPlanMarkdown } from "./helpers";
export type { OnAgentDoneCallback } from "./shared-tools";
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

// Extracted server factories
export { createPrdMcpServer } from "./prd-server";
export type { PrdApprovalCallback } from "./prd-server";
export { createRetroMcpServer } from "./retro-server";
export { createCommonMcpServer, createWorkflowSessionMcpServer } from "./common-server";
export type { WorkflowSessionToolName } from "./common-server";
