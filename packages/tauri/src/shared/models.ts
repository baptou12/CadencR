import { DEFAULT_PROVIDER_ID } from "@/lib/providers";

export const DEFAULT_MODEL = "opus[1m]";
export const DEFAULT_PROVIDER = DEFAULT_PROVIDER_ID;
export const AGENT_TYPES = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
export type AgentTypeSetting = (typeof AGENT_TYPES)[number];
const PHASE_MODEL_KEY_PREFIX = "model_phase_";
export function phaseModelKey(slug: string): string {
  return `${PHASE_MODEL_KEY_PREFIX}${slug}`;
}
