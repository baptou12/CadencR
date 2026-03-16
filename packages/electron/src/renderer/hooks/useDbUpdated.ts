import { useEffect } from "react";
import { trpc } from "@/trpc";
import { useQueryClient } from "@tanstack/react-query";

interface DbUpdateEvent {
  entity: string;
  featureId: number;
}

/**
 * Listens for `db:updated` IPC events from the main process
 * and invalidates the relevant TanStack Query caches per entity type.
 */
export function useDbUpdated() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  useEffect(() => {
    const api = (
      window as unknown as {
        api?: {
          onDbUpdated: (cb: (data: DbUpdateEvent) => void) => unknown;
          offDbUpdated: (listener?: unknown) => void;
        };
      }
    ).api;
    if (!api) return;

    const listener = api.onDbUpdated(({ entity, featureId }) => {
      switch (entity) {
        case "feature":
          void queryClient.invalidateQueries({ queryKey: ["features", "detail", featureId] });
          void queryClient.invalidateQueries({ queryKey: ["features", "list"] });
          break;
        case "phase":
          void queryClient.invalidateQueries({ queryKey: ["features", "planProgress", featureId] });
          void queryClient.invalidateQueries({ queryKey: ["features", "plan", featureId] });
          break;
        case "plan":
          void queryClient.invalidateQueries({ queryKey: ["features", "planProgress", featureId] });
          void queryClient.invalidateQueries({ queryKey: ["features", "plan", featureId] });
          break;
        case "agent_session":
          void utils.sessions.getActiveFeatureIds.invalidate();
          void queryClient.invalidateQueries({ queryKey: ["sessions", "agentState", featureId] });
          void queryClient.invalidateQueries({ queryKey: ["sessions", "turnStates"] });
          break;
      }
    });

    return () => {
      api.offDbUpdated(listener as undefined);
    };
  }, [utils, queryClient]);

  // Also listen for WS-based feature rename events
  useEffect(() => {
    const handler = (e: Event) => {
      const { featureId } = (e as CustomEvent).detail as { featureId: number; title: string };
      void queryClient.invalidateQueries({ queryKey: ["features", "detail", featureId] });
      void queryClient.invalidateQueries({ queryKey: ["features", "list"] });
    };
    window.addEventListener("ws:feature-renamed", handler);
    return () => window.removeEventListener("ws:feature-renamed", handler);
  }, [queryClient]);
}
