import type { AgentBlockData } from "@/components/AgentBlock";

export type PromptDeliveryState = "pending_agent";

export interface LocalUserMessageOptions {
  clientMessageId?: string;
  promptDeliveryState?: PromptDeliveryState;
}

export function movePendingPromptBlocksToTail(blocks: AgentBlockData[]): AgentBlockData[] {
  const firstPending = blocks.findIndex(isPendingPromptBlock);
  if (firstPending === -1 || pendingBlocksAlreadyAtTail(blocks, firstPending)) {
    return blocks;
  }
  const stable: AgentBlockData[] = [];
  const pending: AgentBlockData[] = [];
  for (const block of blocks) {
    (isPendingPromptBlock(block) ? pending : stable).push(block);
  }
  return [...stable, ...pending];
}

export function markPromptReceived(
  blocks: AgentBlockData[],
  clientMessageId: string,
): AgentBlockData[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.clientMessageId !== clientMessageId) return block;
    changed = true;
    const received = { ...block };
    delete received.clientMessageId;
    delete received.promptDeliveryState;
    return received;
  });
  return changed ? next : blocks;
}

export function removePendingPromptBlocks(blocks: AgentBlockData[]): AgentBlockData[] {
  if (!blocks.some(isPendingPromptBlock)) return blocks;
  const next = blocks.filter((block) => !isPendingPromptBlock(block));
  return next.length === blocks.length ? blocks : next;
}

function isPendingPromptBlock(block: AgentBlockData): boolean {
  return block.promptDeliveryState === "pending_agent";
}

function pendingBlocksAlreadyAtTail(blocks: AgentBlockData[], firstPending: number): boolean {
  for (let i = firstPending; i < blocks.length; i += 1) {
    if (!isPendingPromptBlock(blocks[i])) return false;
  }
  return true;
}
