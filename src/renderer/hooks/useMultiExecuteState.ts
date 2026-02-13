import { useState, useCallback, useRef } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/components/AgentPanel";
import type { AgentEvent } from "../../main/agents/types";

let blockIdCounter = 0;
function makeBlock(partial: Omit<AgentBlockData, "id">): AgentBlockData {
  blockIdCounter += 1;
  return { id: `mblock-${blockIdCounter}`, ...partial };
}

function appendToParent(
  blocks: AgentBlockData[],
  parentToolUseId: string,
  newBlock: AgentBlockData,
): AgentBlockData[] {
  return blocks.map((b) => {
    if (
      b.type === "tool_call" &&
      b.toolName === "Task" &&
      b.toolUseId === parentToolUseId
    ) {
      return { ...b, childBlocks: [...(b.childBlocks ?? []), newBlock] };
    }
    if (b.childBlocks) {
      const updated = appendToParent(b.childBlocks, parentToolUseId, newBlock);
      if (updated !== b.childBlocks) return { ...b, childBlocks: updated };
    }
    return b;
  });
}

function updateLastChildInParent(
  blocks: AgentBlockData[],
  parentToolUseId: string,
  updater: (child: AgentBlockData) => AgentBlockData | null,
  fallback?: Omit<AgentBlockData, "id">,
): AgentBlockData[] {
  return blocks.map((b) => {
    if (
      b.type === "tool_call" &&
      b.toolName === "Task" &&
      b.toolUseId === parentToolUseId
    ) {
      const children = b.childBlocks ?? [];
      if (children.length > 0) {
        const last = children[children.length - 1];
        const updated = updater(last);
        if (updated) return { ...b, childBlocks: [...children.slice(0, -1), updated] };
      }
      if (fallback) return { ...b, childBlocks: [...children, makeBlock(fallback)] };
      return b;
    }
    if (b.childBlocks) {
      const updated = updateLastChildInParent(b.childBlocks, parentToolUseId, updater, fallback);
      if (updated !== b.childBlocks) return { ...b, childBlocks: updated };
    }
    return b;
  });
}

export interface ExecuteSubprocessState {
  subprocessId: string;
  blocks: AgentBlockData[];
  status: AgentStatus;
}

/**
 * Manages multiple parallel execute subprocess states.
 * Each subprocess gets its own block list and status.
 * The session-level "all done" event (subprocessId starting with "session-")
 * marks the overall execution as complete.
 */
export function useMultiExecuteState() {
  // Map of subprocess ID → { blocks, status }
  const [subprocesses, setSubprocesses] = useState<Map<string, ExecuteSubprocessState>>(new Map());
  const [overallStatus, setOverallStatus] = useState<AgentStatus>("idle");
  const subprocessesRef = useRef(subprocesses);
  subprocessesRef.current = subprocesses;

  const handleEvent = useCallback((agentEvent: AgentEvent) => {
    const { subprocessId, event } = agentEvent;

    // Session-level "all done" event — mark overall as complete
    if (event.type === "agent_done" && subprocessId.startsWith("session-")) {
      setOverallStatus("complete");
      return;
    }

    // Skip events without a real subprocess ID
    if (!subprocessId || subprocessId.startsWith("session-")) return;

    const parentId = agentEvent.parentToolUseId ?? null;

    setSubprocesses((prev) => {
      const next = new Map(prev);
      const existing = next.get(subprocessId) ?? {
        subprocessId,
        blocks: [],
        status: "running" as AgentStatus,
      };

      let blocks = existing.blocks;
      let status = existing.status;

      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "text") {
            const newBlock = makeBlock({
              type: "text",
              content: event.content_block.text,
              parentToolUseId: parentId,
            });
            blocks = parentId
              ? appendToParent(blocks, parentId, newBlock)
              : [...blocks, newBlock];
          } else if (event.content_block.type === "tool_use") {
            const tb = event.content_block;
            const hasInput = tb.input && Object.keys(tb.input).length > 0;
            const newBlock = makeBlock({
              type: "tool_call",
              content: hasInput ? JSON.stringify(tb.input, null, 2) : "",
              toolName: tb.name,
              toolArgs: hasInput ? JSON.stringify(tb.input, null, 2) : "",
              toolUseId: tb.id,
              parentToolUseId: parentId,
              childBlocks: tb.name === "Task" ? [] : undefined,
            });
            blocks = parentId
              ? appendToParent(blocks, parentId, newBlock)
              : [...blocks, newBlock];
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            const dt = event.delta.text;
            if (parentId) {
              blocks = updateLastChildInParent(
                blocks,
                parentId,
                (child) =>
                  child.type === "text"
                    ? { ...child, content: child.content + dt }
                    : null,
                { type: "text", content: dt, parentToolUseId: parentId },
              );
            } else {
              if (blocks.length === 0) {
                blocks = [makeBlock({ type: "text", content: dt })];
              } else {
                const last = blocks[blocks.length - 1];
                if (last.type === "text" && !last.parentToolUseId) {
                  blocks = [...blocks.slice(0, -1), { ...last, content: last.content + dt }];
                } else {
                  blocks = [...blocks, makeBlock({ type: "text", content: dt })];
                }
              }
            }
          } else if (event.delta.type === "input_json_delta") {
            const pj = event.delta.partial_json;
            if (parentId) {
              blocks = updateLastChildInParent(blocks, parentId, (child) =>
                child.type === "tool_call"
                  ? { ...child, toolArgs: (child.toolArgs ?? "") + pj, content: (child.content ?? "") + pj }
                  : null,
              );
            } else if (blocks.length > 0) {
              const last = blocks[blocks.length - 1];
              if (last.type === "tool_call") {
                blocks = [
                  ...blocks.slice(0, -1),
                  { ...last, toolArgs: (last.toolArgs ?? "") + pj, content: (last.content ?? "") + pj },
                ];
              }
            }
          }
          break;
        }
        case "tool_result": {
          const trBlock = makeBlock({
            type: "tool_result",
            content: event.content,
            isError: event.is_error ?? false,
            parentToolUseId: parentId,
          });
          if (parentId) {
            blocks = appendToParent(blocks, parentId, trBlock);
          } else {
            const updated = [...blocks, trBlock];
            blocks = updated.map((b) =>
              b.type === "tool_call" && b.toolName === "Task" && b.toolUseId === event.tool_use_id
                ? { ...b, taskComplete: true }
                : b,
            );
          }
          break;
        }
        case "result": {
          status = "complete";
          break;
        }
        case "agent_done": {
          if (status === "running") {
            status = event.exitCode === 0 ? "complete" : "error";
          }
          break;
        }
        case "error": {
          status = "error";
          blocks = [...blocks, makeBlock({ type: "text", content: `Error: ${event.error.message}` })];
          break;
        }
      }

      next.set(subprocessId, { subprocessId, blocks, status });
      return next;
    });
  }, []);

  const start = useCallback(() => {
    setSubprocesses(new Map());
    setOverallStatus("running");
  }, []);

  const reset = useCallback(() => {
    setSubprocesses(new Map());
    setOverallStatus("idle");
  }, []);

  const setStatus = useCallback((s: AgentStatus) => {
    setOverallStatus(s);
  }, []);

  // Flatten for rendering
  const subprocessList = Array.from(subprocesses.values());

  // Merged blocks for compatibility (used by feature state machine)
  const allBlocks = subprocessList.flatMap((s) => s.blocks);

  // Subprocess IDs for stop functionality
  const subprocessIds = subprocessList
    .filter((s) => s.status === "running")
    .map((s) => s.subprocessId);

  const appendBlock = useCallback((partial: Omit<AgentBlockData, "id">) => {
    // Append to a virtual "global" subprocess entry
    setSubprocesses((prev) => {
      const next = new Map(prev);
      const globalKey = "__global__";
      const existing = next.get(globalKey) ?? { subprocessId: globalKey, blocks: [], status: "running" as AgentStatus };
      next.set(globalKey, { ...existing, blocks: [...existing.blocks, makeBlock(partial)] });
      return next;
    });
  }, []);

  return {
    subprocessList,
    overallStatus,
    allBlocks,
    subprocessIds,
    handleEvent,
    start,
    reset,
    setStatus,
    appendBlock,
    // Compatibility with useAgentState interface
    blocks: allBlocks,
    status: overallStatus,
    subprocessId: subprocessIds[0] ?? null,
    subprocessIdRef: { current: null } as React.RefObject<string | null>,
    pendingQuestions: [] as Array<{ question: string; options: Array<{ label: string; description?: string }> }>,
    trackSubprocess: () => {},
    clearQuestions: () => {},
  };
}
