import type { AgentBlockData } from "./AgentBlock";

function isHiddenByRenderer(block: AgentBlockData): boolean {
  if (block.type === "thinking") return !block.content.trim();
  if (block.type !== "tool_result") return false;
  if (block.sourceToolName === "Agent" || block.sourceToolName === "Task") return false;
  return true;
}

export function filterRenderableBlocks(blocks: AgentBlockData[]): AgentBlockData[] {
  const visible: AgentBlockData[] = [];
  for (const block of blocks) {
    if (isHiddenByRenderer(block)) continue;
    visible.push(block);
  }
  return visible;
}

export function buildDisplayBlockKeys(blocks: AgentBlockData[]): string[] {
  const ids = blocks.map((block) => block.id);
  const uniqueIds = new Set<string>();
  let hasDuplicate = false;
  for (const id of ids) {
    if (uniqueIds.has(id)) {
      hasDuplicate = true;
      break;
    }
    uniqueIds.add(id);
  }
  if (!hasDuplicate) return ids;

  const totalById = new Map<string, number>();
  for (const id of ids) totalById.set(id, (totalById.get(id) ?? 0) + 1);
  const seenById = new Map<string, number>();
  return ids.map((id: string): string => {
    const total = totalById.get(id) ?? 0;
    if (total <= 1) return id;
    const seen = seenById.get(id) ?? 0;
    seenById.set(id, seen + 1);
    return `${id}#${seen}`;
  });
}

export function deriveAgentStreamDisplayBlocks(blocks: AgentBlockData[]): AgentBlockData[] {
  return filterRenderableBlocks(blocks.filter((block) => !block.parentToolUseId));
}

export function countRenderableDisplayRows(blocks: AgentBlockData[]): number {
  return deriveAgentStreamDisplayBlocks(blocks).length;
}
