/**
 * Shared agent type definitions used by frontend components.
 * Kept minimal after legacy agent system removal.
 */

export type AgentType =
  | "plan"
  | "prd"
  | "execute"
  | "risk"
  | "review"
  | "session"
  | "qa"
  | "review-fixer"
  | "retro";

export interface AgentEvent {
  type: string;
  featureId?: number;
  sessionDbId?: number;
  agentType?: AgentType;
  [key: string]: unknown;
}
