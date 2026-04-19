import type { AgentTypeSetting } from "./models";
import type { RuntimeModelOption } from "@/api/agentRuntime";

export const THINKING_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingEffortLevel = (typeof THINKING_EFFORT_LEVELS)[number];

export const THINKING_EFFORT_LABELS: Record<ThinkingEffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function isThinkingEffortLevel(value: unknown): value is ThinkingEffortLevel {
  return typeof value === "string" && THINKING_EFFORT_LEVELS.includes(value as ThinkingEffortLevel);
}

export function thinkingEffortSettingKey(agentType: AgentTypeSetting): string {
  return `thinking_effort_${agentType}`;
}

export function parseThinkingEffort(value: string | null | undefined): ThinkingEffortLevel | undefined {
  return isThinkingEffortLevel(value) ? value : undefined;
}

export function supportedThinkingEffortLevels(model: Pick<RuntimeModelOption, "supports_effort" | "supported_effort_levels"> | null | undefined): ThinkingEffortLevel[] {
  if (!model?.supports_effort) return [];
  return [...(model.supported_effort_levels ?? [])]
    .filter(isThinkingEffortLevel)
    .sort((left, right) => THINKING_EFFORT_LEVELS.indexOf(left) - THINKING_EFFORT_LEVELS.indexOf(right));
}

export function isThinkingEffortSupported(levels: readonly ThinkingEffortLevel[], effort: string | null | undefined): effort is ThinkingEffortLevel {
  return typeof effort === "string" && levels.includes(effort as ThinkingEffortLevel);
}

export function nextThinkingEffort(
  levels: readonly ThinkingEffortLevel[],
  current: string | null | undefined,
): ThinkingEffortLevel | undefined {
  if (levels.length === 0) return undefined;
  const currentIndex = levels.findIndex((level) => level === current);
  const nextIndex = (currentIndex + 1 + levels.length) % levels.length;
  return levels[nextIndex];
}
