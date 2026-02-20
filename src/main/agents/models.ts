import { resolveSetting } from "../db/settings";
import type { AgentType } from "./types";

export type { AgentType } from "./types";
import { DEFAULT_MODEL } from "../../shared/models";
export { DEFAULT_MODEL, type ClaudeModel } from "../../shared/models";

/**
 * Resolve the model for a given agent type, checking feature → project → global → default.
 */
export function resolveModel(
  agentType: AgentType,
  featureId?: number,
  projectId?: number,
): string {
  return resolveSetting(`model_${agentType}`, { featureId, projectId, defaultValue: DEFAULT_MODEL })!;
}
