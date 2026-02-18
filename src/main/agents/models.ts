import { getDatabase } from "../db/database";
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
  const db = getDatabase();
  const key = `model_${agentType}`;

  // 1. Feature-level setting
  if (featureId != null) {
    const row = db
      .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = ?")
      .get(featureId, key) as { value: string } | undefined;
    if (row?.value) return row.value;
  }

  // 2. Project-level setting
  if (projectId != null) {
    const row = db
      .prepare("SELECT value FROM project_settings WHERE project_id = ? AND key = ?")
      .get(projectId, key) as { value: string } | undefined;
    if (row?.value) return row.value;
  }

  // 3. Global setting
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (row?.value) return row.value;

  // 4. Default
  return DEFAULT_MODEL;
}
