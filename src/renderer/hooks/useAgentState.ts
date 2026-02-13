import { useState, useCallback, useRef, useEffect } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { AgentEvent } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentPanel";

let blockIdCounter = 0;
function makeBlock(partial: Omit<AgentBlockData, "id">): AgentBlockData {
  blockIdCounter += 1;
  return { id: `block-${blockIdCounter}`, ...partial };
}

/**
 * Find a Task block by its toolUseId and append a child block to it.
 */
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
    // Recurse into nested Task blocks
    if (b.childBlocks) {
      const updatedChildren = appendToParent(
        b.childBlocks,
        parentToolUseId,
        newBlock,
      );
      if (updatedChildren !== b.childBlocks) {
        return { ...b, childBlocks: updatedChildren };
      }
    }
    return b;
  });
}

/**
 * Update the last child of a parent Task block using an updater function.
 * If updater returns null, append a fallback block instead.
 */
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
        if (updated) {
          return { ...b, childBlocks: [...children.slice(0, -1), updated] };
        }
      }
      // Append fallback if updater returned null or no children
      if (fallback) {
        return { ...b, childBlocks: [...children, makeBlock(fallback)] };
      }
      return b;
    }
    // Recurse
    if (b.childBlocks) {
      const updatedChildren = updateLastChildInParent(
        b.childBlocks,
        parentToolUseId,
        updater,
        fallback,
      );
      if (updatedChildren !== b.childBlocks) {
        return { ...b, childBlocks: updatedChildren };
      }
    }
    return b;
  });
}

/** Normalize an option value to a string (handles both string and {label, description} formats) */
function normalizeOption(opt: unknown): string {
  if (typeof opt === "string") return opt;
  if (opt && typeof opt === "object" && "label" in opt)
    return String((opt as { label: string }).label);
  return String(opt);
}

function parseQuestions(toolInput: Record<string, unknown>): AgentQuestion[] {
  const questions: AgentQuestion[] = [];
  if (Array.isArray(toolInput.questions)) {
    for (const q of toolInput.questions) {
      const qObj = q as { question: string; options?: unknown[] };
      questions.push({
        question: qObj.question,
        options: Array.isArray(qObj.options)
          ? qObj.options.map(normalizeOption)
          : [],
      });
    }
  } else if (typeof toolInput.question === "string") {
    questions.push({
      question: toolInput.question as string,
      options: Array.isArray(toolInput.options)
        ? (toolInput.options as unknown[]).map(normalizeOption)
        : [],
    });
  }
  return questions;
}

interface UseAgentStateOptions {
  /** Whether this agent type supports AskUserQuestion tool calls */
  supportsQuestions?: boolean;
}

export function useAgentState(options: UseAgentStateOptions = {}) {
  const { supportsQuestions = false } = options;

  const [blocks, setBlocks] = useState<AgentBlockData[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [subprocessId, setSubprocessId] = useState<string | null>(null);
  const subprocessIdRef = useRef<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<AgentQuestion[]>([]);

  const handleEvent = useCallback(
    (agentEvent: AgentEvent) => {
      const { event } = agentEvent;

      const parentId = agentEvent.parentToolUseId ?? null;

      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "text") {
            const newBlock = makeBlock({
              type: "text",
              content:
                event.content_block.type === "text"
                  ? event.content_block.text
                  : "",
              parentToolUseId: parentId,
            });
            if (parentId) {
              setBlocks((prev) => appendToParent(prev, parentId, newBlock));
            } else {
              setBlocks((prev) => [...prev, newBlock]);
            }
          } else if (event.content_block.type === "tool_use") {
            const toolBlock = event.content_block;
            // Note: during streaming, input arrives empty here; questions are parsed on content_block_stop
            if (
              supportsQuestions &&
              toolBlock.name === "AskUserQuestion" &&
              Object.keys(toolBlock.input).length > 0
            ) {
              const parsed = parseQuestions(
                toolBlock.input as Record<string, unknown>,
              );
              if (parsed.length > 0) {
                setPendingQuestions(parsed);
              }
            }
            const hasInput =
              toolBlock.input && Object.keys(toolBlock.input).length > 0;
            const newBlock = makeBlock({
              type: "tool_call",
              content: hasInput ? JSON.stringify(toolBlock.input, null, 2) : "",
              toolName: toolBlock.name,
              toolArgs: hasInput
                ? JSON.stringify(toolBlock.input, null, 2)
                : "",
              toolUseId: toolBlock.id,
              parentToolUseId: parentId,
              childBlocks: toolBlock.name === "Task" ? [] : undefined,
            });
            if (parentId) {
              setBlocks((prev) => appendToParent(prev, parentId, newBlock));
            } else {
              setBlocks((prev) => [...prev, newBlock]);
            }
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            const deltaText = event.delta.text;
            if (parentId) {
              setBlocks((prev) =>
                updateLastChildInParent(
                  prev,
                  parentId,
                  (child) => {
                    if (child.type === "text")
                      return { ...child, content: child.content + deltaText };
                    return null; // signal to append new block
                  },
                  {
                    type: "text",
                    content: deltaText,
                    parentToolUseId: parentId,
                  },
                ),
              );
            } else {
              setBlocks((prev) => {
                if (prev.length === 0)
                  return [makeBlock({ type: "text", content: deltaText })];
                const last = prev[prev.length - 1];
                if (last.type === "text" && !last.parentToolUseId) {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: last.content + deltaText },
                  ];
                }
                return [
                  ...prev,
                  makeBlock({ type: "text", content: deltaText }),
                ];
              });
            }
          } else if (event.delta.type === "input_json_delta") {
            const partialJson = event.delta.partial_json;
            if (parentId) {
              setBlocks((prev) =>
                updateLastChildInParent(prev, parentId, (child) => {
                  if (child.type === "tool_call") {
                    return {
                      ...child,
                      toolArgs: (child.toolArgs ?? "") + partialJson,
                      content: (child.content ?? "") + partialJson,
                    };
                  }
                  return null;
                }),
              );
            } else {
              setBlocks((prev) => {
                if (prev.length === 0) return prev;
                const last = prev[prev.length - 1];
                if (last.type === "tool_call") {
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      toolArgs: (last.toolArgs ?? "") + partialJson,
                      content: (last.content ?? "") + partialJson,
                    },
                  ];
                }
                return prev;
              });
            }
          }
          break;
        }
        case "tool_result": {
          // Check if this tool_result corresponds to a Task block's toolUseId — mark it complete
          const toolResultBlock = makeBlock({
            type: "tool_result",
            content: event.content,
            isError: event.is_error ?? false,
            parentToolUseId: parentId,
          });

          if (parentId) {
            setBlocks((prev) =>
              appendToParent(prev, parentId, toolResultBlock),
            );
          } else {
            // Also check if this result completes a Task block
            setBlocks((prev) => {
              const updated = [...prev, toolResultBlock];
              // Mark matching Task block as complete
              return updated.map((b) =>
                b.type === "tool_call" &&
                b.toolName === "Task" &&
                b.toolUseId === event.tool_use_id
                  ? { ...b, taskComplete: true }
                  : b,
              );
            });
          }
          break;
        }
        case "content_block_stop": {
          // When a tool_use block finishes, try to parse accumulated args
          if (supportsQuestions) {
            setBlocks((prev) => {
              // Find the last tool_call block
              for (let i = prev.length - 1; i >= 0; i--) {
                const block = prev[i];
                if (
                  block.type === "tool_call" &&
                  block.toolName === "AskUserQuestion" &&
                  block.toolArgs
                ) {
                  try {
                    const parsed = parseQuestions(
                      JSON.parse(block.toolArgs) as Record<string, unknown>,
                    );
                    if (parsed.length > 0) {
                      setPendingQuestions(parsed);
                    }
                  } catch {
                    // Not valid JSON yet, skip
                  }
                  break;
                }
              }
              return prev; // no mutation
            });
          }
          break;
        }
        case "message_stop": {
          break;
        }
        case "result": {
          setStatus("complete");
          break;
        }
        case "agent_done": {
          setStatus((prev) => (prev === "running" ? "complete" : prev));
          break;
        }
        case "error": {
          setStatus("error");
          setBlocks((prev) => [
            ...prev,
            makeBlock({
              type: "text",
              content: `Error: ${event.error.message}`,
            }),
          ]);
          break;
        }
      }
    },
    [supportsQuestions],
  );

  const reset = useCallback(() => {
    setBlocks([]);
    setStatus("idle");
    setPendingQuestions([]);
    setSubprocessId(null);
    subprocessIdRef.current = null;
  }, []);

  const start = useCallback(() => {
    setBlocks([]);
    setStatus("running");
    setPendingQuestions([]);
  }, []);

  const trackSubprocess = useCallback((id: string) => {
    setSubprocessId(id);
    subprocessIdRef.current = id;
  }, []);

  const clearQuestions = useCallback(() => {
    setPendingQuestions([]);
  }, []);

  const appendBlock = useCallback((partial: Omit<AgentBlockData, "id">) => {
    setBlocks((prev) => [...prev, makeBlock(partial)]);
  }, []);

  return {
    blocks,
    status,
    setStatus,
    subprocessId,
    subprocessIdRef,
    pendingQuestions,
    handleEvent,
    reset,
    start,
    trackSubprocess,
    clearQuestions,
    appendBlock,
  };
}

/**
 * Hook to listen for agent events via the IPC bridge and dispatch
 * them to the correct agent state handler.
 */
export function useAgentEventListener(
  handlers: Record<
    string,
    {
      handleEvent: (event: AgentEvent) => void;
      subprocessIdRef?: React.RefObject<string | null>;
    }
  >,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const api = (
      window as unknown as {
        api?: {
          onAgentEvent: (cb: (event: unknown) => void) => unknown;
          offAgentEvent: (listener?: unknown) => void;
        };
      }
    ).api;
    if (!api) return;

    const listener = api.onAgentEvent((data: unknown) => {
      const agentEvent = data as AgentEvent;
      const handler = handlersRef.current[agentEvent.agentType];
      if (!handler) {
        return;
      }

      // If handler has a subprocess filter, check it
      if (handler.subprocessIdRef) {
        const currentId = handler.subprocessIdRef.current;
        if (currentId && agentEvent.subprocessId !== currentId) {
          return;
        }
      }

      handler.handleEvent(agentEvent);
    });

    return () => {
      api.offAgentEvent(listener as undefined);
    };
  }, []);
}
