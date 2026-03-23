/**
 * Agent type definitions for frontend components.
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
