import type { AgentBlockData } from "@/components/AgentBlock";
import { extractUserMessageText } from "@/types/agent-types";

export function getLatestUserPromptText(blocks: AgentBlockData[]): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type !== "user_message") continue;
    const text = extractUserMessageText(block.content).trim();
    if (text && text !== "Plan approved.") return text;
  }
  return "";
}
