import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentSessionState } from "@/types/workflow";

export interface AgentStreamErrorBlock {
  sessionId: number;
  block: AgentBlockData;
}

function sessionIdFromPayload(payload: Record<string, unknown>): number | null {
  return typeof payload.session_id === "number" ? payload.session_id : null;
}

function errorContent(error: string): string {
  return error.startsWith("Error: ") ? error : `Error: ${error}`;
}

export function buildAgentStreamErrorBlock(
  payload: Record<string, unknown>,
): AgentStreamErrorBlock | null {
  const msgType = payload.type ?? payload.msg_type;
  const error = payload.error;
  const sessionId = sessionIdFromPayload(payload);
  if (msgType !== "error" || typeof error !== "string" || error.trim().length === 0) {
    return null;
  }
  if (sessionId === null) return null;
  return {
    sessionId,
    block: {
      id: `ws-error-${sessionId}-${Date.now()}`,
      type: "text",
      content: errorContent(error),
      isError: true,
    },
  };
}

export function appendErrorBlock(
  agent: AgentSessionState,
  block: AgentBlockData,
): AgentSessionState {
  const lastBlock = agent.blocks[agent.blocks.length - 1];
  if (lastBlock?.isError === true && lastBlock.content === block.content) {
    return agent.status === "error" ? agent : { ...agent, status: "error" };
  }
  return { ...agent, status: "error", blocks: [...agent.blocks, block] };
}
