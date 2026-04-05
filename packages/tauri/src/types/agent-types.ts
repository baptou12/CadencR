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
  | "retro"
  | (string & {});  // Custom workflow phase slugs (e.g. "specify", "analyze")

/** Image payload sent with prompts to agents. */
export interface ImagePayload {
  base64: string;
  mimeType: string;
}

/** Build the `content` string for a user_message block (plain text or JSON with images). */
export function buildUserMessageContent(text: string, images?: ImagePayload[]): string {
  if (!images || images.length === 0) return text;
  return JSON.stringify([
    { type: "text", text },
    ...images.map(img => ({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.base64 },
    })),
  ]);
}

export interface AgentEvent {
  type: string;
  featureId?: number;
  sessionDbId?: number;
  agentType?: AgentType;
  [key: string]: unknown;
}
