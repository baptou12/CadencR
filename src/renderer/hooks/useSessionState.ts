/**
 * Unified renderer state hook for all agent types.
 *
 * Manages both single-subprocess state (blocks, status, questions) and
 * multi-subprocess tracking (for execute agent parallelism) in a single hook
 * configurable via options.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { AgentEvent, AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentSession";

// ---------------------------------------------------------------------------
// Block helpers (shared between single and multi mode)
// ---------------------------------------------------------------------------

let blockIdCounter = 0;
function makeBlock(partial: Omit<AgentBlockData, "id">): AgentBlockData {
  blockIdCounter += 1;
  return { id: `sblock-${blockIdCounter}`, ...partial };
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
      if (fallback) {
        return { ...b, childBlocks: [...children, makeBlock(fallback)] };
      }
      return b;
    }
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

// ---------------------------------------------------------------------------
// Question parsing helpers
// ---------------------------------------------------------------------------

function normalizeOption(opt: unknown): { label: string; description?: string } {
  if (typeof opt === "string") return { label: opt };
  if (opt && typeof opt === "object" && "label" in opt) {
    const obj = opt as { label: string; description?: unknown };
    return {
      label: String(obj.label),
      description:
        typeof obj.description === "string" ? obj.description : undefined,
    };
  }
  return { label: String(opt) };
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

// ---------------------------------------------------------------------------
// Client-side pattern matching
// ---------------------------------------------------------------------------

/** A pattern to match against accumulated text on the client side. */
export interface ClientOutputPattern {
  pattern: RegExp;
  event: string;
}

/** Payload received from the backend `agent:pattern-match` IPC event. */
export interface PatternMatchPayload {
  subprocessId: string;
  agentType: AgentType;
  event: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Per-subprocess state (for multi-subprocess mode)
// ---------------------------------------------------------------------------

export interface SubprocessState {
  subprocessId: string;
  blocks: AgentBlockData[];
  status: AgentStatus;
  /** DB session ID (agent_sessions.id) — set from AgentEvent or synthetic history IDs */
  sessionDbId?: number;
}

// ---------------------------------------------------------------------------
// Hook configuration
// ---------------------------------------------------------------------------

export interface UseSessionStateOptions {
  /** Whether this agent supports AskUserQuestion tool calls (default: false) */
  supportsQuestions?: boolean;
  /** Whether this agent manages multiple parallel subprocesses (default: false) */
  supportsMultiSubprocess?: boolean;
  /**
   * Client-side output patterns to match against accumulated text blocks.
   * When a pattern matches, onPatternMatch is called.
   */
  outputPatterns?: ClientOutputPattern[];
  /**
   * Callback invoked when a client-side pattern matches or when a backend
   * `agent:pattern-match` IPC event is received.
   */
  onPatternMatch?: (event: string, fullText: string) => void;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface SessionStateReturn {
  // --- Common (single-subprocess compat) ---
  blocks: AgentBlockData[];
  status: AgentStatus;
  setStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
  subprocessId: string | null;
  subprocessIdRef: React.RefObject<string | null>;
  sessionDbId: number | null;
  sessionDbIdRef: React.RefObject<number | null>;
  pendingQuestions: AgentQuestion[];
  /** Which subprocess ID asked the current pending questions (for multi-subprocess mode) */
  questionSubprocessId: string | null;
  /** Whether any file-modifying tool (Write, Edit, NotebookEdit) was used during this session */
  hasFileChanges: boolean;
  handleEvent: (agentEvent: AgentEvent) => void;
  reset: () => void;
  start: () => void;
  trackSubprocess: (id: string, sessionDbId?: number) => void;
  clearQuestions: () => void;
  appendBlock: (partial: Omit<AgentBlockData, "id">) => void;

  // --- Multi-subprocess (execute compat) ---
  subprocessList: SubprocessState[];
  overallStatus: AgentStatus;
  allBlocks: AgentBlockData[];
  subprocessIds: string[];
  appendBlockToSubprocess: (
    subprocessId: string,
    partial: Omit<AgentBlockData, "id">,
    subStatus?: AgentStatus,
    sessionDbId?: number,
  ) => void;
  /** Re-key a subprocess entry so events from `newId` route into the existing `oldId` panel */
  remapSubprocess: (oldId: string, newId: string) => void;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useSessionState(
  options: UseSessionStateOptions = {},
): SessionStateReturn {
  const {
    supportsQuestions = false,
    supportsMultiSubprocess = false,
    outputPatterns,
    onPatternMatch,
  } = options;

  // Refs that survive across renders for pattern callbacks
  const onPatternMatchRef = useRef(onPatternMatch);
  onPatternMatchRef.current = onPatternMatch;
  const outputPatternsRef = useRef(outputPatterns);
  outputPatternsRef.current = outputPatterns;

  // ----- Single-subprocess state -----
  const [singleBlocks, setSingleBlocks] = useState<AgentBlockData[]>([]);
  const [singleStatus, setSingleStatus] = useState<AgentStatus>("idle");
  const [singleSubprocessId, setSingleSubprocessId] = useState<string | null>(
    null,
  );
  const singleSubprocessIdRef = useRef<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<AgentQuestion[]>([]);
  /** Tracks which subprocess ID asked the current pending questions (for multi-subprocess mode) */
  const [questionSubprocessId, setQuestionSubprocessId] = useState<string | null>(null);

  /** Whether any file-modifying tool (Write, Edit, NotebookEdit) was used */
  const FILE_CHANGING_TOOLS = useRef(new Set(["Write", "Edit", "NotebookEdit"]));
  const [hasFileChanges, setHasFileChanges] = useState(false);

  // Client-side pattern matching dedup (single mode)
  const singleMatchedPatterns = useRef(new Set<string>());

  // ----- Multi-subprocess state -----
  const [subprocesses, setSubprocesses] = useState<
    Map<string, SubprocessState>
  >(new Map());
  const [multiOverallStatus, setMultiOverallStatus] =
    useState<AgentStatus>("idle");

  // Client-side pattern matching dedup (multi mode — keyed by subprocess)
  const multiMatchedPatterns = useRef(new Map<string, Set<string>>());

  // ----- Client-side pattern matching helper -----
  const checkClientPatterns = useCallback(
    (fullText: string, matchedSet: Set<string>) => {
      const patterns = outputPatternsRef.current;
      if (!patterns || patterns.length === 0) return;
      for (const { pattern, event } of patterns) {
        if (matchedSet.has(event)) continue;
        if (pattern.test(fullText)) {
          matchedSet.add(event);
          onPatternMatchRef.current?.(event, fullText);
        }
      }
    },
    [],
  );

  // Helper: extract full text from blocks for client-side pattern matching
  const extractFullText = useCallback(
    (blocks: AgentBlockData[]): string =>
      blocks
        .filter((b) => b.type === "text")
        .map((b) => b.content)
        .join(""),
    [],
  );

  // ----- Single subprocess event handler -----
  const handleSingleEvent = useCallback(
    (agentEvent: AgentEvent) => {
      const { event } = agentEvent;
      const parentId = agentEvent.parentToolUseId ?? null;

      // Capture sessionDbId from the first event if not already set
      if (agentEvent.sessionDbId != null && singleSessionDbIdRef.current == null) {
        setSingleSessionDbId(agentEvent.sessionDbId);
        singleSessionDbIdRef.current = agentEvent.sessionDbId;
      }

      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "text") {
            const newBlock = makeBlock({
              type: "text",
              content: event.content_block.text,
              parentToolUseId: parentId,
            });
            if (parentId) {
              setSingleBlocks((prev) =>
                appendToParent(prev, parentId, newBlock),
              );
            } else {
              setSingleBlocks((prev) => [...prev, newBlock]);
            }
          } else if (event.content_block.type === "tool_use") {
            const toolBlock = event.content_block;
            if (FILE_CHANGING_TOOLS.current.has(toolBlock.name)) {
              setHasFileChanges(true);
            }
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
              content: hasInput
                ? JSON.stringify(toolBlock.input, null, 2)
                : "",
              toolName: toolBlock.name,
              toolArgs: hasInput
                ? JSON.stringify(toolBlock.input, null, 2)
                : "",
              toolUseId: toolBlock.id,
              parentToolUseId: parentId,
              childBlocks: toolBlock.name === "Task" ? [] : undefined,
            });
            if (parentId) {
              setSingleBlocks((prev) =>
                appendToParent(prev, parentId, newBlock),
              );
            } else {
              setSingleBlocks((prev) => [...prev, newBlock]);
            }
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            const deltaText = event.delta.text;
            if (parentId) {
              setSingleBlocks((prev) =>
                updateLastChildInParent(
                  prev,
                  parentId,
                  (child) => {
                    if (child.type === "text")
                      return { ...child, content: child.content + deltaText };
                    return null;
                  },
                  {
                    type: "text",
                    content: deltaText,
                    parentToolUseId: parentId,
                  },
                ),
              );
            } else {
              setSingleBlocks((prev) => {
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
              setSingleBlocks((prev) =>
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
              setSingleBlocks((prev) => {
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
          const toolResultBlock = makeBlock({
            type: "tool_result",
            content: event.content,
            isError: event.is_error ?? false,
            parentToolUseId: parentId,
          });
          if (parentId) {
            setSingleBlocks((prev) =>
              appendToParent(prev, parentId, toolResultBlock),
            );
          } else {
            setSingleBlocks((prev) => {
              const updated = [...prev, toolResultBlock];
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
          if (supportsQuestions) {
            setSingleBlocks((prev) => {
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
              return prev;
            });
          }
          break;
        }
        case "message_stop": {
          break;
        }
        case "result": {
          setSingleStatus("complete");
          break;
        }
        case "agent_done": {
          setSingleStatus((prev) => (prev === "running" ? "complete" : prev));
          break;
        }
        case "turn_complete": {
          setSingleStatus("paused");
          break;
        }
        case "error": {
          setSingleStatus("error");
          setSingleBlocks((prev) => [
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

  // ----- Multi-subprocess event handler -----
  const handleMultiEvent = useCallback(
    (agentEvent: AgentEvent) => {
      const { subprocessId, event } = agentEvent;

      // Session-level "all done" event
      if (event.type === "agent_done" && subprocessId.startsWith("session-")) {
        setMultiOverallStatus(
          event.exitCode === 0 ? "complete" : "error",
        );
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
          sessionDbId: agentEvent.sessionDbId,
        };

        let blocks = existing.blocks;
        let status = existing.status;

        // Resume from paused when new content arrives
        if (
          status === "paused" &&
          (event.type === "content_block_start" ||
            event.type === "content_block_delta")
        ) {
          status = "running";
        }

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
              if (FILE_CHANGING_TOOLS.current.has(tb.name)) {
                setHasFileChanges(true);
              }
              // Detect AskUserQuestion in multi-subprocess mode
              if (
                supportsQuestions &&
                tb.name === "AskUserQuestion" &&
                tb.input && Object.keys(tb.input).length > 0
              ) {
                const parsed = parseQuestions(
                  tb.input as Record<string, unknown>,
                );
                if (parsed.length > 0) {
                  setPendingQuestions(parsed);
                  setQuestionSubprocessId(subprocessId);
                }
              }
              const hasInput = tb.input && Object.keys(tb.input).length > 0;
              const newBlock = makeBlock({
                type: "tool_call",
                content: hasInput
                  ? JSON.stringify(tb.input, null, 2)
                  : "",
                toolName: tb.name,
                toolArgs: hasInput
                  ? JSON.stringify(tb.input, null, 2)
                  : "",
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
                    blocks = [
                      ...blocks.slice(0, -1),
                      { ...last, content: last.content + dt },
                    ];
                  } else {
                    blocks = [
                      ...blocks,
                      makeBlock({ type: "text", content: dt }),
                    ];
                  }
                }
              }
            } else if (event.delta.type === "input_json_delta") {
              const pj = event.delta.partial_json;
              if (parentId) {
                blocks = updateLastChildInParent(
                  blocks,
                  parentId,
                  (child) =>
                    child.type === "tool_call"
                      ? {
                          ...child,
                          toolArgs: (child.toolArgs ?? "") + pj,
                          content: (child.content ?? "") + pj,
                        }
                      : null,
                );
              } else if (blocks.length > 0) {
                const last = blocks[blocks.length - 1];
                if (last.type === "tool_call") {
                  blocks = [
                    ...blocks.slice(0, -1),
                    {
                      ...last,
                      toolArgs: (last.toolArgs ?? "") + pj,
                      content: (last.content ?? "") + pj,
                    },
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
                b.type === "tool_call" &&
                b.toolName === "Task" &&
                b.toolUseId === event.tool_use_id
                  ? { ...b, taskComplete: true }
                  : b,
              );
            }
            break;
          }
          case "content_block_stop": {
            // Re-parse questions from accumulated toolArgs (streaming JSON case)
            if (supportsQuestions) {
              for (let i = blocks.length - 1; i >= 0; i--) {
                const block = blocks[i];
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
                      setQuestionSubprocessId(subprocessId);
                    }
                  } catch {
                    // Not valid JSON yet, skip
                  }
                  break;
                }
              }
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
          case "agent_paused": {
            status = "paused";
            break;
          }
          case "error": {
            status = "error";
            blocks = [
              ...blocks,
              makeBlock({
                type: "text",
                content: `Error: ${event.error.message}`,
              }),
            ];
            break;
          }
        }

        next.set(subprocessId, { subprocessId, blocks, status });
        return next;
      });
    },
    [supportsQuestions],
  );

  // ----- Unified event dispatcher -----
  const handleEvent = useCallback(
    (agentEvent: AgentEvent) => {
      if (supportsMultiSubprocess) {
        handleMultiEvent(agentEvent);
      } else {
        handleSingleEvent(agentEvent);
      }
    },
    [supportsMultiSubprocess, handleMultiEvent, handleSingleEvent],
  );

  // ----- Client-side pattern matching on block changes -----
  // Single mode: watch singleBlocks
  useEffect(() => {
    if (supportsMultiSubprocess) return;
    if (!outputPatternsRef.current || outputPatternsRef.current.length === 0)
      return;
    const fullText = extractFullText(singleBlocks);
    if (fullText) {
      checkClientPatterns(fullText, singleMatchedPatterns.current);
    }
  }, [
    singleBlocks,
    supportsMultiSubprocess,
    extractFullText,
    checkClientPatterns,
  ]);

  // Multi mode: watch subprocesses
  useEffect(() => {
    if (!supportsMultiSubprocess) return;
    if (!outputPatternsRef.current || outputPatternsRef.current.length === 0)
      return;
    for (const [spId, sp] of subprocesses) {
      let matched = multiMatchedPatterns.current.get(spId);
      if (!matched) {
        matched = new Set<string>();
        multiMatchedPatterns.current.set(spId, matched);
      }
      const fullText = extractFullText(sp.blocks);
      if (fullText) {
        checkClientPatterns(fullText, matched);
      }
    }
  }, [
    subprocesses,
    supportsMultiSubprocess,
    extractFullText,
    checkClientPatterns,
  ]);

  // ----- Listen for backend `agent:pattern-match` IPC events -----
  useEffect(() => {
    const api = (
      window as unknown as {
        api?: {
          onPatternMatch?: (
            cb: (data: unknown) => void,
          ) => unknown;
          offPatternMatch?: (listener?: unknown) => void;
        };
      }
    ).api;
    if (!api?.onPatternMatch) return;

    const listener = api.onPatternMatch((data: unknown) => {
      const payload = data as PatternMatchPayload;
      // Delegate to callback
      onPatternMatchRef.current?.(payload.event, "");
    });

    return () => {
      api.offPatternMatch?.(listener);
    };
  }, []);

  // ----- Actions -----
  const reset = useCallback(() => {
    setHasFileChanges(false);
    if (supportsMultiSubprocess) {
      setSubprocesses(new Map());
      setMultiOverallStatus("idle");
      multiMatchedPatterns.current = new Map();
    } else {
      setSingleBlocks([]);
      setSingleStatus("idle");
      setPendingQuestions([]);
      setSingleSubprocessId(null);
      singleSubprocessIdRef.current = null;
      setSingleSessionDbId(null);
      singleSessionDbIdRef.current = null;
      singleMatchedPatterns.current = new Set();
    }
  }, [supportsMultiSubprocess]);

  const start = useCallback(() => {
    setHasFileChanges(false);
    if (supportsMultiSubprocess) {
      setSubprocesses(new Map());
      setMultiOverallStatus("running");
      multiMatchedPatterns.current = new Map();
    } else {
      setSingleBlocks([]);
      setSingleStatus("running");
      setPendingQuestions([]);
      singleMatchedPatterns.current = new Set();
    }
  }, [supportsMultiSubprocess]);

  // ----- Session DB ID tracking (stable across refresh) -----
  const [singleSessionDbId, setSingleSessionDbId] = useState<number | null>(null);
  const singleSessionDbIdRef = useRef<number | null>(null);

  const trackSubprocess = useCallback((id: string, sessionDbId?: number) => {
    setSingleSubprocessId(id);
    singleSubprocessIdRef.current = id;
    if (sessionDbId != null) {
      setSingleSessionDbId(sessionDbId);
      singleSessionDbIdRef.current = sessionDbId;
    }
  }, []);

  const clearQuestions = useCallback(() => {
    setPendingQuestions([]);
    setQuestionSubprocessId(null);
  }, []);

  const appendBlock = useCallback(
    (partial: Omit<AgentBlockData, "id">) => {
      if (supportsMultiSubprocess) {
        // Append to a virtual "global" subprocess entry
        setSubprocesses((prev) => {
          const next = new Map(prev);
          const globalKey = "__global__";
          const existing = next.get(globalKey) ?? {
            subprocessId: globalKey,
            blocks: [],
            status: "running" as AgentStatus,
          };
          next.set(globalKey, {
            ...existing,
            blocks: [...existing.blocks, makeBlock(partial)],
          });
          return next;
        });
      } else {
        setSingleBlocks((prev) => [...prev, makeBlock(partial)]);
      }
    },
    [supportsMultiSubprocess],
  );

  const appendBlockToSubprocess = useCallback(
    (spId: string, partial: Omit<AgentBlockData, "id">, subStatus?: AgentStatus, sessionDbId?: number) => {
      setSubprocesses((prev) => {
        const next = new Map(prev);
        const existing = next.get(spId) ?? {
          subprocessId: spId,
          blocks: [],
          status: subStatus ?? ("running" as AgentStatus),
          sessionDbId,
        };
        next.set(spId, {
          ...existing,
          blocks: [...existing.blocks, makeBlock(partial)],
        });
        return next;
      });
    },
    [],
  );

  const remapSubprocess = useCallback((oldId: string, newId: string) => {
    setSubprocesses((prev) => {
      const entry = prev.get(oldId);
      if (!entry) return prev;
      // Rebuild the Map preserving insertion order (replace in-place, don't delete+append)
      const next = new Map<string, SubprocessState>();
      for (const [key, value] of prev) {
        if (key === oldId) {
          next.set(newId, { ...value, subprocessId: newId, status: "running" });
        } else {
          next.set(key, value);
        }
      }
      return next;
    });
  }, []);

  // ----- Derived values for multi-subprocess mode -----
  const subprocessList = Array.from(subprocesses.values());
  const allBlocks = subprocessList.flatMap((s) => s.blocks);
  const activeSubprocessIds = subprocessList
    .filter((s) => s.status === "running")
    .map((s) => s.subprocessId);

  // ----- Choose the right values based on mode -----
  const blocks = supportsMultiSubprocess ? allBlocks : singleBlocks;
  const status = supportsMultiSubprocess ? multiOverallStatus : singleStatus;
  const setStatus = supportsMultiSubprocess
    ? (setMultiOverallStatus as React.Dispatch<React.SetStateAction<AgentStatus>>)
    : setSingleStatus;
  const subprocessId = supportsMultiSubprocess
    ? (activeSubprocessIds[0] ?? null)
    : singleSubprocessId;
  const subprocessIdRef = supportsMultiSubprocess
    ? ({ current: null } as React.RefObject<string | null>)
    : singleSubprocessIdRef;
  const sessionDbId = supportsMultiSubprocess ? null : singleSessionDbId;
  const sessionDbIdRef = supportsMultiSubprocess
    ? ({ current: null } as React.RefObject<number | null>)
    : singleSessionDbIdRef;

  return {
    // Common (single-subprocess compat)
    blocks,
    status,
    setStatus,
    subprocessId,
    subprocessIdRef,
    sessionDbId,
    sessionDbIdRef,
    pendingQuestions,
    questionSubprocessId,
    hasFileChanges,
    handleEvent,
    reset,
    start,
    trackSubprocess,
    clearQuestions,
    appendBlock,

    // Multi-subprocess (execute compat)
    subprocessList,
    overallStatus: multiOverallStatus,
    allBlocks,
    subprocessIds: activeSubprocessIds,
    appendBlockToSubprocess,
    remapSubprocess,
  };
}

/**
 * Hook to listen for agent events via the IPC bridge and dispatch
 * them to the correct agent state handler.
 */
export function useSessionEventListener(
  handlers: Record<
    string,
    {
      handleEvent: (event: AgentEvent) => void;
      subprocessIdRef?: React.RefObject<string | null>;
      sessionDbIdRef?: React.RefObject<number | null>;
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

      // Route by sessionDbId first (stable across refresh), then by subprocessId
      if (handler.sessionDbIdRef?.current != null) {
        if (agentEvent.sessionDbId !== handler.sessionDbIdRef.current) {
          return;
        }
      } else if (handler.subprocessIdRef?.current) {
        if (agentEvent.subprocessId !== handler.subprocessIdRef.current) {
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
