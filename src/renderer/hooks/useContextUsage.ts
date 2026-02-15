/**
 * Hook that tracks context window usage per agent session.
 *
 * Seeds from DB data (survives page refresh) and updates live from IPC events.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { AgentEvent } from "../../main/agents/types";

export interface ContextUsageState {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  usageRatio: number;
  wasCompacted: boolean;
}

interface SessionSeed {
  sessionDbId: number;
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  wasCompacted: boolean;
  subprocessId: string | null;
}

export function useContextUsage(
  featureId: number,
  sessions: SessionSeed[],
): Map<number, ContextUsageState> {
  // Build a stable fingerprint so we only re-seed when actual data changes
  const seedKey = useMemo(
    () =>
      sessions
        .map((s) => `${s.sessionDbId}:${s.inputTokens}:${s.outputTokens}:${s.contextWindow}:${s.wasCompacted ? 1 : 0}:${s.subprocessId ?? ""}`)
        .join("|"),
    [sessions],
  );

  const [usageMap, setUsageMap] = useState<Map<number, ContextUsageState>>(new Map());
  const sessionMapRef = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<Map<number, Partial<ContextUsageState>>>(new Map());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Seed from DB data whenever the fingerprint changes
  useEffect(() => {
    const currentSessions = sessionsRef.current;
    const next = new Map<number, ContextUsageState>();
    const subMap = new Map<string, number>();
    for (const s of currentSessions) {
      const total = s.inputTokens + s.outputTokens;
      next.set(s.sessionDbId, {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        totalTokens: total,
        contextWindow: s.contextWindow,
        usageRatio: Math.min(1, s.contextWindow > 0 ? total / s.contextWindow : 0),
        wasCompacted: s.wasCompacted,
      });
      if (s.subprocessId) {
        subMap.set(s.subprocessId, s.sessionDbId);
      }
    }
    sessionMapRef.current = subMap;
    setUsageMap(next);
  }, [seedKey]);

  // Flush pending updates via rAF
  const flush = useCallback(() => {
    rafRef.current = null;
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    setUsageMap((prev) => {
      const next = new Map(prev);
      for (const [sid, patch] of pending) {
        const existing = next.get(sid) ?? {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextWindow: 200000,
          usageRatio: 0,
          wasCompacted: false,
        };
        const merged = { ...existing, ...patch };
        merged.totalTokens = merged.inputTokens + merged.outputTokens;
        merged.usageRatio = Math.min(1, merged.contextWindow > 0 ? merged.totalTokens / merged.contextWindow : 0);
        next.set(sid, merged);
      }
      return next;
    });
    pending.clear();
  }, []);

  // Listen for IPC events
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
      let sessionDbId = agentEvent.sessionDbId;
      if (!sessionDbId && agentEvent.subprocessId) {
        sessionDbId = sessionMapRef.current.get(agentEvent.subprocessId);
      }
      if (agentEvent.subprocessId && agentEvent.sessionDbId) {
        sessionMapRef.current.set(agentEvent.subprocessId, agentEvent.sessionDbId);
      }
      if (!sessionDbId) return;

      const e = agentEvent.event;

      if (e.type === "system" && e.subtype === "usage_update") {
        // Custom event broadcast from main process with total token counts
        const sysEvent = e as { input_tokens?: number; output_tokens?: number };
        const patch = pendingRef.current.get(sessionDbId) ?? {};
        if (sysEvent.input_tokens != null) patch.inputTokens = sysEvent.input_tokens;
        if (sysEvent.output_tokens != null) patch.outputTokens = sysEvent.output_tokens;
        pendingRef.current.set(sessionDbId, patch);
      } else if (e.type === "system" && e.subtype === "compact_boundary") {
        const patch = pendingRef.current.get(sessionDbId) ?? {};
        patch.wasCompacted = true;
        pendingRef.current.set(sessionDbId, patch);
      } else {
        return; // no usage-related event
      }

      // Schedule rAF flush
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    });

    return () => {
      api.offAgentEvent(listener as undefined);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [featureId, flush]);

  return usageMap;
}
