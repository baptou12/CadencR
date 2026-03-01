/**
 * Agent autonomy level resolution.
 * Extracted to break circular dependency between execute-agent and agent-starters.
 */

import { resolveSetting } from "../db/settings";

/**
 * Get autonomy level: feature → project → global settings cascade.
 * Returns 1 (ask before commit), 2 (manual continue), or 3 (full auto).
 */
export function getAutonomyLevel(featureId: number, projectId: number): 1 | 2 | 3 {
  const raw = resolveSetting("agent_autonomy", { featureId, projectId, defaultValue: "1" });
  const val = Number(raw);
  if (val === 1 || val === 2 || val === 3) return val;
  return 1;
}
