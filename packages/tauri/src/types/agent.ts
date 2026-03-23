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
  totalTokens: number;
  contextWindow: number;
  usageRatio: number;
  wasCompacted: boolean;
}
