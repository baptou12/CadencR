import type { AgentBlockData } from "./AgentBlock";
import { isCountableTool } from "./agentStreamSummary";
import { isFileChangeTool, normalizeToolName } from "@/lib/tool-adapter";
import { parseCadencrMcpTool, type CadencrMcpTool } from "@/lib/tool-call-parser";
import { computeToolNumStat } from "@/lib/tool-numstat";
import type { ToolAccent } from "@/lib/tool-accent";

/**
 * One pill in the Summary-mode recap: a tool grouped by name, its run count, the
 * shared accent so it reads like the same tool everywhere, and — for file-change
 * tools — the aggregate `+A`/`-D` numstat across every call in the turn. MCP
 * tools carry their server so the pill can wear the brand badge + friendly label.
 */
export interface ToolChip {
  /** Grouping key (== normalized tool name; MCP raw names are already unique). */
  key: string;
  /** Display label — friendly MCP label, else the normalized tool name. */
  label: string;
  count: number;
  accent: ToolAccent;
  /** MCP server (browser / project / workspace) for the badge, if applicable. */
  mcpServer?: string;
  /** Aggregate added lines across the group (0 when not a file-change tool). */
  additions: number;
  /** Aggregate deleted lines across the group. */
  deletions: number;
}

function classifyAccent(name: string, mcp: CadencrMcpTool | undefined): ToolAccent {
  if (mcp) return "mcp";
  if (name === "Bash") return "bash";
  if (isFileChangeTool(name)) return "edit";
  return "tool";
}

/**
 * Group a turn's countable tool calls into recap chips, preserving
 * first-appearance order. File-change groups accumulate their numstat from each
 * call's args; the heavier diff parse only runs for `edit`-accent groups.
 */
export function buildToolChips(blocks: AgentBlockData[]): ToolChip[] {
  const order: string[] = [];
  const groups = new Map<string, ToolChip>();

  for (const block of blocks) {
    if (!isCountableTool(block)) continue;
    const rawName = block.toolName ?? "unknown";
    const name = normalizeToolName(rawName);

    let chip = groups.get(name);
    if (!chip) {
      // Parse MCP metadata only on first appearance — the label/accent/server
      // are group-wide, so re-parsing args for every repeat call is wasted work.
      const mcp = parseCadencrMcpTool(rawName, block.toolArgs);
      chip = {
        key: name,
        label: mcp?.label ?? name,
        count: 0,
        accent: classifyAccent(name, mcp),
        mcpServer: mcp?.server,
        additions: 0,
        deletions: 0,
      };
      groups.set(name, chip);
      order.push(name);
    }
    chip.count += 1;

    if (chip.accent === "edit") {
      const stats = computeToolNumStat(rawName, block.toolArgs);
      if (stats) {
        chip.additions += stats.additions;
        chip.deletions += stats.deletions;
      }
    }
  }

  return order.map((key) => groups.get(key)!);
}
