export const DEFAULT_MODEL = "opus[1m]";
export const PHASE_MODEL_KEY_PREFIX = "model_phase_";
export function phaseModelKey(slug: string): string {
  return `${PHASE_MODEL_KEY_PREFIX}${slug}`;
}
