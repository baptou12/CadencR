import { useEffect, useState } from "react";

export const FULL_TREE_DEFER_MS = 750;

interface DeferredFullTreeLoadArgs {
  featureId: number;
  trackedReady: boolean;
}

interface DeferredFullTreeState {
  featureId: number;
  enabled: boolean;
}

export function useDeferredFullTreeLoad({
  featureId,
  trackedReady,
}: DeferredFullTreeLoadArgs): boolean {
  const [state, setState] = useState<DeferredFullTreeState>({ featureId, enabled: false });

  useEffect(() => {
    setState((current) =>
      current.featureId === featureId && !current.enabled ? current : { featureId, enabled: false },
    );
    if (!trackedReady) return;

    return scheduleDeferredIdle(() => setState({ featureId, enabled: true }));
  }, [featureId, trackedReady]);

  return state.featureId === featureId && state.enabled;
}

function scheduleDeferredIdle(callback: () => void): () => void {
  let idleHandle: number | null = null;
  const timeoutHandle = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(callback, { timeout: FULL_TREE_DEFER_MS });
      return;
    }
    callback();
  }, FULL_TREE_DEFER_MS);

  return () => {
    window.clearTimeout(timeoutHandle);
    if (idleHandle != null) window.cancelIdleCallback(idleHandle);
  };
}
