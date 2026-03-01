import { useEffect } from "react";
import { trpc } from "@/trpc";

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
          void utils.features.getById.invalidate({ id: featureId });
          void utils.features.listByProject.invalidate();
          break;
        case "phase":
          void utils.features.getProgress.invalidate({ feature_id: featureId });
          void utils.features.getPlanWithPhases.invalidate({ feature_id: featureId });
          break;
        case "plan":
          void utils.features.getProgress.invalidate({ feature_id: featureId });
          void utils.features.getPlanWithPhases.invalidate({ feature_id: featureId });
          break;
        case "agent_session":
          void utils.sessions.getActiveFeatureIds.invalidate();
          void utils.sessions.getSessions.invalidate({ featureId });
          void utils.sessions.getFeatureAgentState.invalidate({ featureId });
          break;
      }
    });

    return () => {
      api.offDbUpdated(listener as undefined);
    };
  }, [utils]);
}
