import type { AgentMessageOrigin } from "@/api/generated";
import type { AgentBlockData } from "@/components/agent-block-types";
import { parseGeneratedSessionGate } from "@/lib/session-gate";
import { parseGeneratedSessionReply } from "@/lib/session-reply";

/** A user message another conversation's agent sent, rather than the person. */
export function isAgentSentMessage(
  block: AgentBlockData,
): block is AgentBlockData & { origin: AgentMessageOrigin } {
  return block.type === "user_message" && block.origin?.originKind === "session_generated";
}

/**
 * An agent-sent message shown as a plain bubble, whose sender tab carries the
 * name and time of the stream's "User · time" line. Replies and gates render
 * as their own cards instead (see renderGeneratedSessionMessage).
 */
export function hasSenderTab(block: AgentBlockData): boolean {
  return (
    isAgentSentMessage(block) &&
    !parseGeneratedSessionReply(block.content, block.origin) &&
    !parseGeneratedSessionGate(block.content, block.origin)
  );
}
