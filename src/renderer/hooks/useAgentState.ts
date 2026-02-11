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

function parseQuestions(toolInput: Record<string, unknown>): AgentQuestion[] {
  const questions: AgentQuestion[] = [];
  if (Array.isArray(toolInput.questions)) {
    for (const q of toolInput.questions) {
      const qObj = q as { question: string; options?: string[] };
      questions.push({
        question: qObj.question,
        options: qObj.options ?? [],
      });
    }
  } else if (typeof toolInput.question === "string") {
    questions.push({
      question: toolInput.question as string,
      options: Array.isArray(toolInput.options)
        ? (toolInput.options as string[])
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

      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "text") {
            setBlocks((prev) => [
              ...prev,
              makeBlock({
                type: "text",
                content:
                  event.content_block.type === "text"
                    ? event.content_block.text
                    : "",
              }),
            ]);
          } else if (event.content_block.type === "tool_use") {
            const toolBlock = event.content_block;
            if (supportsQuestions && toolBlock.name === "AskUserQuestion") {
              const parsed = parseQuestions(
                toolBlock.input as Record<string, unknown>,
              );
              if (parsed.length > 0) {
                setPendingQuestions(parsed);
              }
            }
            setBlocks((prev) => [
              ...prev,
              makeBlock({
                type: "tool_call",
                content: JSON.stringify(toolBlock.input, null, 2),
                toolName: toolBlock.name,
                toolArgs: JSON.stringify(toolBlock.input, null, 2),
              }),
            ]);
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            const deltaText = event.delta.text;
            setBlocks((prev) => {
              if (prev.length === 0)
                return [makeBlock({ type: "text", content: deltaText })];
              const last = prev[prev.length - 1];
              if (last.type === "text") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, content: last.content + deltaText },
                ];
              }
              return [...prev, makeBlock({ type: "text", content: deltaText })];
            });
          }
          break;
        }
        case "tool_result": {
          setBlocks((prev) => [
            ...prev,
            makeBlock({
              type: "tool_result",
              content: event.content,
              isError: event.is_error ?? false,
            }),
          ]);
          break;
        }
        case "message_stop": {
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
      if (!handler) return;

      // If handler has a subprocess filter, check it
      if (handler.subprocessIdRef) {
        const currentId = handler.subprocessIdRef.current;
        if (currentId && agentEvent.subprocessId !== currentId) return;
      }

      handler.handleEvent(agentEvent);
    });

    return () => {
      api.offAgentEvent(listener as undefined);
    };
  }, []);
}
