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

// Re-export server factories (still in the parent mcp-tools.ts for now — will be
// moved in subsequent phases). We re-export types too.
export {
  createPlanMcpServer,
  createExecuteMcpServer,
  createQaMcpServer,
  createReviewMcpServer,
  createRiskMcpServer,
  createPrdMcpServer,
  createRetroMcpServer,
  createCommonMcpServer,
  createWorkflowSessionMcpServer,
} from "../mcp-tools";
export type { PlanApprovalCallback, PrdApprovalCallback } from "../mcp-tools";
