import { z } from "zod";
import { Effect } from "effect";
import { queryOne } from "../db/query";
import type { AgentMessageRow } from "../db/types";
import type { DatabaseError } from "../effect/errors";

/** Check if a feature still has its default auto-generated title (e.g. "Session 3") */
export function hasDefaultTitle(featureId: number): Effect.Effect<boolean, DatabaseError> {
  return Effect.gen(function* () {
    const row = yield* queryOne<{ title: string }>(
      "SELECT title FROM features WHERE id = ?",
      featureId,
    );
    return row != null && /^Session \d+$/i.test(row.title);
  });
}

export const agentTypeSchema = z.enum(["plan", "prd", "execute", "risk", "review", "session", "qa", "review-fixer", "retro"]);

// ---------------------------------------------------------------------------
// Block builder — converts agent_messages rows into a nested block tree
// ---------------------------------------------------------------------------

export interface AgentBlock {
  id: string;
  type: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  toolUseId?: string;
  parentToolUseId?: string | null;
  childBlocks?: AgentBlock[];
  sourceToolName?: string;
  createdAt?: string;
  model?: string;
}

function appendText(list: AgentBlock[], msgId: number, content: string, parentId?: string | null, createdAt?: string, model?: string | null) {
  const last = list.length > 0 ? list[list.length - 1] : null;
  if (last && last.type === "text" && !last.parentToolUseId === !parentId) {
    last.content += content;
    // Keep the first message's id and createdAt for the merged block
  } else {
    list.push({ id: `msg-${msgId}`, type: "text", content, parentToolUseId: parentId, createdAt, model: model ?? undefined });
  }
}

function appendThinking(list: AgentBlock[], msgId: number, content: string, parentId?: string | null, createdAt?: string) {
  const last = list.length > 0 ? list[list.length - 1] : null;
  if (last && last.type === "thinking" && !last.parentToolUseId === !parentId) {
    last.content += content;
  } else {
    list.push({ id: `msg-${msgId}`, type: "thinking", content, parentToolUseId: parentId, createdAt });
  }
}

export function buildBlocks(messages: AgentMessageRow[]): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  const byToolUseId = new Map<string, AgentBlock>();

  function targetList(parentId: string | null | undefined): AgentBlock[] {
    if (parentId) {
      const parent = byToolUseId.get(parentId);
      if (parent?.childBlocks) return parent.childBlocks;
    }
    return blocks;
  }

  for (const msg of messages) {
    const list = targetList(msg.parent_tool_use_id);
    const id = `msg-${msg.id}`;

    switch (msg.message_type) {
      case "text":
      case "text_delta":
        appendText(list, msg.id, msg.content, msg.parent_tool_use_id, msg.created_at, msg.model);
        break;
      case "thinking":
      case "thinking_delta":
        appendThinking(list, msg.id, msg.content, msg.parent_tool_use_id, msg.created_at);
        break;
      case "tool_call": {
        // Deduplicate: if we already have a block with this tool_use_id,
        // update its content instead of creating a duplicate (the SDK sends
        // the same tool_call via both stream_event and assistant messages).
        if (msg.tool_use_id && byToolUseId.has(msg.tool_use_id)) {
          const existing = byToolUseId.get(msg.tool_use_id)!;
          if (msg.content && (!existing.content || existing.content.length < msg.content.length)) {
            existing.content = msg.content;
            existing.toolArgs = msg.content;
          }
          break;
        }
        const isTask = msg.tool_name === "Task" || msg.tool_name === "Agent";
        const block: AgentBlock = {
          id,
          type: "tool_call",
          content: msg.content,
          toolName: msg.tool_name ?? "tool",
          toolArgs: msg.content,
          toolUseId: msg.tool_use_id ?? undefined,
          parentToolUseId: msg.parent_tool_use_id,
          childBlocks: isTask ? [] : undefined,
          createdAt: msg.created_at,
        };
        if (msg.tool_use_id) byToolUseId.set(msg.tool_use_id, block);
        list.push(block);
        break;
      }
      case "tool_result":
      case "tool_error": {
        // Resolve the source tool name from the parent tool_call
        let sourceToolName: string | undefined;
        if (msg.tool_use_id && byToolUseId.has(msg.tool_use_id)) {
          sourceToolName = byToolUseId.get(msg.tool_use_id)!.toolName;
        } else {
          // Fallback for historical data where tool_use_id is null on tool_result rows:
          // scan backwards for the last tool_call in this list
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].type === "tool_call") {
              sourceToolName = list[i].toolName;
              break;
            }
          }
        }
        list.push({
          id,
          type: "tool_result",
          content: msg.content,
          isError: msg.message_type === "tool_error",
          parentToolUseId: msg.parent_tool_use_id,
          sourceToolName,
          createdAt: msg.created_at,
        });
        break;
      }
      case "user_message":
        list.push({ id, type: "user_message", content: msg.content, parentToolUseId: msg.parent_tool_use_id, createdAt: msg.created_at });
        break;
      case "error":
        list.push({ id, type: "text", content: `Error: ${msg.content}`, parentToolUseId: msg.parent_tool_use_id });
        break;
      case "compact_divider":
        list.push({ id, type: "compact_divider", content: "", parentToolUseId: msg.parent_tool_use_id });
        break;
      case "clear_divider":
        list.push({ id, type: "clear_divider", content: "", parentToolUseId: msg.parent_tool_use_id });
        break;
    }
  }
  return blocks;
}
