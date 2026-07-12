import type { AgentBlockData } from "@/components/AgentBlock";
import type { PromptDeliveryState } from "@/types/agent";

export interface TailPromptTurnBoundary {
  blocks: AgentBlockData[];
  shouldTrim: boolean;
}

export function markPromptReceived(
  blocks: AgentBlockData[],
  messageUuid: string,
): AgentBlockData[] {
  return markPromptsReceived(blocks, [messageUuid]);
}

/** Resolve acknowledged prompts without changing canonical transcript order. */
export function markPromptsReceived(
  blocks: AgentBlockData[],
  messageUuids: readonly string[],
): AgentBlockData[] {
  return updatePromptDeliveryState(blocks, messageUuids, "received_agent");
}

export function markPromptDeliveryFailed(
  blocks: AgentBlockData[],
  messageUuid: string,
): AgentBlockData[] {
  return updatePromptDeliveryState(blocks, [messageUuid], "delivery_failed");
}

export function markPendingPromptsUnknown(blocks: AgentBlockData[]): AgentBlockData[] {
  return updatePendingPromptDeliveryState(blocks, "delivery_unknown");
}

export function markPendingPromptsFailed(blocks: AgentBlockData[]): AgentBlockData[] {
  return updatePendingPromptDeliveryState(blocks, "delivery_failed");
}

function updatePendingPromptDeliveryState(
  blocks: AgentBlockData[],
  state: PromptDeliveryState,
): AgentBlockData[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (!isPendingPromptBlock(block)) return block;
    changed = true;
    return { ...block, promptDeliveryState: state };
  });
  return changed ? next : blocks;
}

function updatePromptDeliveryState(
  blocks: AgentBlockData[],
  messageUuids: readonly string[],
  state: PromptDeliveryState,
): AgentBlockData[] {
  const identities = new Set(messageUuids);
  let changed = false;
  const next = blocks.map((block) => {
    const identity = block.messageUuid;
    if (!identity || !identities.has(identity) || block.promptDeliveryState === state) return block;
    changed = true;
    return { ...block, promptDeliveryState: state };
  });
  return changed ? next : blocks;
}

export function trimTailPromptTurnBoundary(blocks: AgentBlockData[]): TailPromptTurnBoundary {
  const promptIndex = lastPromptDeliveryBlockIndex(blocks);
  if (promptIndex === -1) {
    return { blocks, shouldTrim: false };
  }

  for (let index = promptIndex + 1; index < blocks.length; index += 1) {
    if (!isIgnorableTrailingPromptBlock(blocks[index])) {
      return { blocks, shouldTrim: false };
    }
  }

  return {
    blocks: promptIndex === blocks.length - 1 ? blocks : blocks.slice(0, promptIndex + 1),
    shouldTrim: true,
  };
}

function isPendingPromptBlock(block: AgentBlockData): boolean {
  return block.promptDeliveryState === "pending_agent";
}

function isPromptDeliveryBlock(block: AgentBlockData): boolean {
  return (
    block.type === "user_message" &&
    (block.promptDeliveryState === "pending_agent" ||
      block.promptDeliveryState === "received_agent" ||
      block.promptDeliveryState === "delivery_unknown" ||
      block.promptDeliveryState === "delivery_failed")
  );
}

function isIgnorableTrailingPromptBlock(block: AgentBlockData): boolean {
  return block.type === "turn_summary";
}

function lastPromptDeliveryBlockIndex(blocks: AgentBlockData[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (isIgnorableTrailingPromptBlock(block)) continue;
    return isPromptDeliveryBlock(block) ? index : -1;
  }
  return -1;
}
