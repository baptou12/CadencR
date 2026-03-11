import { Effect } from "effect";
import { resolveSetting } from "../db/settings";
import type { AgentType } from "./types";

export type { AgentType } from "./types";
import { DEFAULT_MODEL } from "../../shared/models";
export { DEFAULT_MODEL, type ClaudeModel } from "../../shared/models";

/**
 * Resolve the model for a given agent type, checking feature → project → global → default.
 * The literal value "default" is treated as unset and falls through to DEFAULT_MODEL.
 */
export function resolveModel(
  agentType: AgentType,
  featureId?: number,
  projectId?: number,
): string {
  const resolved = Effect.runSync(resolveSetting(`model_${agentType}`, { featureId, projectId, defaultValue: DEFAULT_MODEL }))!;
  return resolved === "default" ? DEFAULT_MODEL : resolved;
}
