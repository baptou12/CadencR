import type { AgentBlockData } from "./AgentBlock";
import { isTaskTodoTool } from "@/lib/tool-adapter";

/** Options controlling how turns collapse into recaps. */
export interface CollapseOptions {
  /**
   * When true, the final (in-flight) turn is left uncollapsed and streams live.
   * The recap is produced only once a turn *ends* — so the user watches the
   * active turn normally and it folds to a recap the moment it finishes.
   */
  activeStreaming?: boolean;
}

/**
 * Block types that end the current turn's tool accumulation. Each starts a new
 * segment: the pending tool recap is flushed, then the boundary block is passed
 * through untouched. `user_message` covers both the initial prompt and any
 * mid-turn steering message — every user input gets its own recap.
 */
const SEGMENT_BOUNDARY_TYPES = new Set<AgentBlockData["type"]>([
  "user_message",
  "turn_summary",
  "compact_divider",
  "clear_divider",
  "error",
]);

/**
 * Whether a block closes the current turn and opens a new one. A steer message
 * sent mid-turn is appended immediately with `promptDeliveryState: "pending_agent"`,
 * but the agent hasn't received it yet — collapsing the in-flight turn at that
 * moment is wrong. So a `user_message` only becomes a boundary once the agent has
 * acknowledged it (delivery state flips to `received_agent`, or is untracked for
 * history/idle sends). Until then the pending message rides inside the live turn.
 */
function isSegmentBoundary(block: AgentBlockData): boolean {
  if (!SEGMENT_BOUNDARY_TYPES.has(block.type)) return false;
  if (block.type === "user_message" && block.promptDeliveryState === "pending_agent") return false;
  return true;
}

/** A turn: an optional leading boundary block plus the blocks that follow it. */
interface Segment {
  boundary: AgentBlockData | null;
  body: AgentBlockData[];
}

/**
 * Tools that never render in the stream (todo bookkeeping) are not counted.
 * Exported so the recap renderer builds its chips from the same tool set.
 */
export function isCountableTool(block: AgentBlockData): boolean {
  if (block.type !== "tool_call") return false;
  if (block.toolName === "TodoWrite" || isTaskTodoTool(block.toolName)) return false;
  return true;
}

/**
 * Stable synthetic id for a turn's recap block. Anchored on the first tool of
 * the segment so it stays constant while more tools stream in (only its content
 * changes) — Virtuoso keeps the row instead of remounting it mid-turn, and the
 * user's expand toggle survives new chunks.
 */
function toolSummaryId(firstToolId: string): string {
  return `tool-summary-${firstToolId}`;
}

/**
 * Build the recap block. The turn's intermediate content (every body block
 * except the final message) rides on `childBlocks` — in-memory only. The
 * renderer derives the per-tool recap chips from those blocks and reveals them
 * inline when the recap is expanded, exactly like a Task/Agent block surfaces
 * its subagent steps. `tools` only gates whether a recap is worth emitting.
 */
function makeToolSummaryBlock(tools: AgentBlockData[], detail: AgentBlockData[]): AgentBlockData {
  return {
    id: toolSummaryId(tools[0].id),
    type: "tool_summary",
    content: "",
    childBlocks: detail,
  };
}

/** Split a block list into turns delimited by boundary blocks. */
function splitSegments(blocks: AgentBlockData[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { boundary: null, body: [] };
  for (const block of blocks) {
    if (isSegmentBoundary(block)) {
      segments.push(current);
      current = { boundary: block, body: [] };
      continue;
    }
    current.body.push(block);
  }
  segments.push(current);
  return segments;
}

/** The turn's closing message — its last text block, ignoring earlier preamble. */
function findFinalText(body: AgentBlockData[]): AgentBlockData | null {
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i].type === "text") return body[i];
  }
  return null;
}

/** Emit a single segment into `result` under the current collapse options. */
function emitSegment(result: AgentBlockData[], segment: Segment, active: boolean): void {
  if (segment.boundary) result.push(segment.boundary);

  // In-flight turn: render everything live; the recap appears only once it ends.
  if (active) {
    result.push(...segment.body);
    return;
  }

  const tools = segment.body.filter(isCountableTool);
  const finalText = findFinalText(segment.body);
  if (tools.length === 0) {
    // No countable tools — nothing to recap; keep just the closing message.
    if (finalText) result.push(finalText);
    return;
  }

  // Recap header carries the turn's detail (everything but the final message) on
  // `childBlocks`; the renderer reveals it inline via an animated collapsible.
  // The closing message always stays visible below the recap.
  const detail = finalText ? segment.body.filter((block) => block !== finalText) : segment.body;
  result.push(makeToolSummaryBlock(tools, detail));
  if (finalText) result.push(finalText);
}

/**
 * "Summary mode" display transform. Collapses each *finished* turn's tool calls
 * into a single `tool_summary` recap block, followed by only the turn's final
 * text — so the history reads as "user message → recap → final answer". The
 * recap carries the turn's detail on `childBlocks`, which the renderer reveals
 * inline via an animated collapsible (row count is unchanged by expansion). The
 * in-flight turn streams normally and folds to a recap the moment it ends (see
 * `activeStreaming`).
 *
 * Pure function of the current (already root-filtered) block list, so it
 * recomputes cleanly on every batch — including mid-turn steering, where a
 * pending steer message stays inside the live turn until the agent acknowledges
 * it and only then starts a fresh segment (see `isSegmentBoundary`).
 */
export function collapseTurnsToSummary(
  blocks: AgentBlockData[],
  options: CollapseOptions = {},
): AgentBlockData[] {
  const { activeStreaming = false } = options;
  const segments = splitSegments(blocks);
  const lastIndex = segments.length - 1;
  const result: AgentBlockData[] = [];
  segments.forEach((segment, index) => {
    emitSegment(result, segment, activeStreaming && index === lastIndex);
  });
  return result;
}
