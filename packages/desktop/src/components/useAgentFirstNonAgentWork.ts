import { useEffect, useState } from "react";

export const AGENT_FIRST_NON_AGENT_WORK_DELAY_MS = 1_200;

interface DeferredWorkState {
  resetKey: string;
  ready: boolean;
}

interface UseAgentFirstNonAgentWorkOptions {
  enabled: boolean;
  immediate: boolean;
  resetKey: string;
}

export function useAgentFirstNonAgentWork({
  enabled,
  immediate,
  resetKey,
}: UseAgentFirstNonAgentWorkOptions): boolean {
  const [state, setState] = useState<DeferredWorkState>(() => ({
    resetKey,
    ready: false,
  }));

  useEffect((): (() => void) | void => {
    setState((current) => {
      if (current.resetKey !== resetKey) return { resetKey, ready: immediate };
      return immediate && !current.ready ? { resetKey, ready: true } : current;
    });
    if (!enabled || immediate) return undefined;

    const timer = window.setTimeout(() => {
      setState((current) => (current.resetKey === resetKey ? { resetKey, ready: true } : current));
    }, AGENT_FIRST_NON_AGENT_WORK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, immediate, resetKey]);

  const timerReadyForCurrentSession = state.resetKey === resetKey && state.ready;
  return enabled && (immediate || timerReadyForCurrentSession);
}
