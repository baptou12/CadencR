/**
 * MCP tool servers for agent types.
 *
 * All server factories have been extracted to the mcp-tools/ subdirectory.
 * This file re-exports for backward compatibility.
 */

export { renderPlanMarkdown } from "./mcp-tools/helpers";
export type { OnAgentDoneCallback } from "./mcp-tools/shared-tools";

export { createPlanMcpServer } from "./mcp-tools/plan-server";
export type { PlanApprovalCallback } from "./mcp-tools/plan-server";
export { createExecuteMcpServer } from "./mcp-tools/execute-server";

export { createQaMcpServer } from "./mcp-tools/qa-server";
export { createReviewMcpServer } from "./mcp-tools/review-server";
export { createRiskMcpServer } from "./mcp-tools/risk-server";

export { createPrdMcpServer } from "./mcp-tools/prd-server";
export type { PrdApprovalCallback } from "./mcp-tools/prd-server";
export { createRetroMcpServer } from "./mcp-tools/retro-server";
export { createCommonMcpServer, createWorkflowSessionMcpServer } from "./mcp-tools/common-server";
