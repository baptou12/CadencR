/**
 * Shared agent types used across renderer components and hooks.
 * Extracted to break circular dependencies between AgentSession,
 * AgentPromptBar, and useFeatureAgentState.
 */

export type AgentStatus = "idle" | "running" | "completed" | "error" | "paused" | "waiting";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface ContextUsageState {
  inputTokens: number;
  outputTokens: number;
  /** `null` means the provider has not reported an authoritative window yet. */
  contextWindow: number | null;
  wasCompacted: boolean;
}

export function normalizeContextWindow(contextWindow: number | null | undefined): number | null {
  return contextWindow != null && contextWindow > 0 ? contextWindow : null;
}

export function totalTokens(usage: ContextUsageState): number {
  return usage.inputTokens + usage.outputTokens;
}

export function usageRatio(usage: ContextUsageState): number {
  if (!usage.contextWindow || usage.contextWindow <= 0) return 0;
  return Math.min(1, totalTokens(usage) / usage.contextWindow);
}
