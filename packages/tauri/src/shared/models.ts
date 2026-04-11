export const DEFAULT_MODEL = "opus[1m]";
export const DEFAULT_PROVIDER = "claude_code";
export const AGENT_TYPES = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
export type AgentTypeSetting = (typeof AGENT_TYPES)[number];
const PHASE_MODEL_KEY_PREFIX = "model_phase_";
export function phaseModelKey(slug: string): string {
  return `${PHASE_MODEL_KEY_PREFIX}${slug}`;
}
